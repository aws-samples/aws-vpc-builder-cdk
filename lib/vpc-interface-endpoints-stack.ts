import { Construct } from "constructs";
import { ServiceDetail } from "@aws-sdk/client-ec2";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as r53 from "aws-cdk-lib/aws-route53";
import * as r53t from "aws-cdk-lib/aws-route53-targets";
import {
  IBuilderVpcProps,
  IBuilderVpcStyle,
  IBuildVpcProvides,
  ITgwAttachType,
  ITgwPropagateRouteAttachmentName,
  ITgw,
} from "./types";
import { BuilderVpc } from "./abstract-buildervpc";

export interface IVpcInterfaceEndpointsProps extends IBuilderVpcProps {
  /**
   * List of Interfaces to create.  Use Discovery formatting (ie: [ 'com.amazonaws.us-east-1.ec2', 'com.amazonaws.us-east-1.ec2messages' ]
   */
  interfaceList: Array<string>;
  /**
   * Entire list of interfaces available within the union of all Availability Zones specified in availabilityZones.  Use Discovery process to popaulte.
   */
  interfaceDiscovery: Array<ServiceDetail>;
  /**
   * Existing Security Group for our Interfaces to use.
   * @default One is created permitting from 0.0.0.0/0 port 443
   */
  interfaceEndpointSecurityGroup?: ec2.SecurityGroup;
  /**
   * The Mask to use when creating the Interface Subnets.
   * @default 22
   */
  perSubnetCidrMask?: number;
  /**
   * The VPCs that will be using the interfaces.
   */
  interfaceEndpointSharedWithVpcs?: Array<ITgwPropagateRouteAttachmentName>;
  // not supporting a non-transit gateway version of this
  tgw: ITgw;
}

export class VpcInterfaceEndpointsStack extends BuilderVpc {
  vpcStyle: IBuilderVpcStyle = "serviceInterfaceEndpoint";
  tgwAttachType: ITgwAttachType = "vpc";
  withTgw: boolean = true;
  provides: IBuildVpcProvides = "endpoints";
  props: IVpcInterfaceEndpointsProps;
  interfaceEndpointSecurityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: IVpcInterfaceEndpointsProps
  ) {
    super(scope, id, props);

    // Build our Name
    this.name =
      `${props.namePrefix}-provider-endpoint-service-interface`.toLowerCase();
    // Create the VPC
    this.createEndpointVpc();

    // If we have a security group passed use it, otherwise create a sane default
    props.interfaceEndpointSecurityGroup
      ? (this.interfaceEndpointSecurityGroup =
          props.interfaceEndpointSecurityGroup)
      : this.endpointSecurityGroup();

    // Now the meat of it, create our Interface Endpoints
    // This whole section creates a 'dependsOn' chain that assures that no more than 3 endpoints
    // private hosted zones, and records are created at once.  Otherwise CloudFormation will happily exceed
    // the throttles in place and fail out.
    let previousEndpoint: ec2.InterfaceVpcEndpoint;
    props.interfaceList.forEach((endpointName, index) => {
      // Our first three positions are com.amazonaws.{region}.  We'll retain after that and sub our . for a -
      let endpointNameTemp = endpointName.split(".");
      endpointNameTemp.splice(0, 3);
      const endpointNameShort = endpointNameTemp.join("-");

      const endpoint = new ec2.InterfaceVpcEndpoint(
        this,
        `InterfaceEndpoint-${endpointNameShort}`,
        {
          privateDnsEnabled: false,
          service: new ec2.InterfaceVpcEndpointAwsService(
            endpointNameShort as string
          ),
          vpc: this.vpc,
          securityGroups: [this.interfaceEndpointSecurityGroup],
        }
      );

      // We will do endpoints in batches of three to keep from hitting service throttles.
      if (index == 0) {
        previousEndpoint = endpoint;
      } else if (index % 3 == 0) {
        endpoint.node.addDependency(previousEndpoint);
        previousEndpoint = endpoint;
      } else {
        endpoint.node.addDependency(previousEndpoint);
      }

      // Create our private hosted zone where we have a private DNS name is available from our service
      const endpointPrivateDnsName = this.lookupPrivateDnsName(endpointName);
      // Confirm this endpoint is available in all the AZs our stack will be deployed to
      if(!this.serviceAvailableInAllAzs(endpointName)) {
        throw new Error(`Endpoint ${endpointName} is not available in all Availability Zones: ${this.availabilityZones.join(',')}`)
      }
      if (endpointPrivateDnsName) {
        const privateHostedZone = new r53.PrivateHostedZone(
          this,
          `PrivateHostedZone-${endpointNameShort}`,
          {
            vpc: this.vpc,
            zoneName: endpointPrivateDnsName,
          }
        );

        // Where additional VPCs are to be associated, do that here
        if (props.interfaceEndpointSharedWithVpcs) {
          for (const sharedWith of props.interfaceEndpointSharedWithVpcs) {
            if (sharedWith.attachTo instanceof BuilderVpc) {
              privateHostedZone.addVpc(sharedWith.attachTo.vpc);
            }
          }
        }
        privateHostedZone.node.addDependency(endpoint);

        // Create our recordset
        const recordSet = new r53.ARecord(
          this,
          `EndpointRecord-${endpointNameShort}`,
          {
            target: r53.RecordTarget.fromAlias(
              new r53t.InterfaceVpcEndpointTarget(endpoint)
            ),
            zone: privateHostedZone,
          }
        );
        recordSet.node.addDependency(privateHostedZone);
      }
    });
  }

  createEndpointVpc() {
    const vpcProps: ec2.VpcProps = {
      ipAddresses: ec2.IpAddresses.cidr(this.props.vpcCidr),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [
        {
          name: "interface-endpoints",
          // 1024 Addresses per subnet unless we're over-ridden
          cidrMask: this.props.perSubnetCidrMask
            ? this.props.perSubnetCidrMask
            : 22,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    };
    this.privateIsolatedSubnetNames.push("interface-endpoints");

    if (this.props.tgw) {
      vpcProps.subnetConfiguration?.push({
        name: "transit-gateway",
        cidrMask: 28,
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      });
      this.privateIsolatedSubnetNames.push("transit-gateway");
    }

    this.vpc = new ec2.Vpc(this, this.name, vpcProps);
  }

  endpointSecurityGroup() {
    this.interfaceEndpointSecurityGroup = new ec2.SecurityGroup(
      this,
      "VPCEndpointSecurityGroup",
      {
        allowAllOutbound: true,
        description: "Security Group for VPC Interface Endpoints",
        securityGroupName: "VPCEndpointSecurityGroup",
        vpc: this.vpc,
      }
    );
    this.interfaceEndpointSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow endpoint use from any address via HTTPS"
    );
  }

  // Confirm the serviceName requested exists in the Availability Zones our VPC will be created in
  serviceAvailableInAllAzs(serviceName: string): boolean {
    const service = this.props.interfaceDiscovery.find(
        (service) => service.ServiceName == serviceName
    );
    if(service) {
      if (service.AvailabilityZones) {
        return this.availabilityZones.every(
            (i) => service.AvailabilityZones?.includes(i),
        );
      }
    }
      return false;
  }

  lookupPrivateDnsName(serviceName: string): string | undefined {
    const service = this.props.interfaceDiscovery.find(
      (service) => service.ServiceName == serviceName
    );
    if (service) {
      return service.PrivateDnsName;
    } else {
      throw new Error(
        `Interface Endpoint named ${serviceName} not found in discovery files`
      );
    }
  }
}
