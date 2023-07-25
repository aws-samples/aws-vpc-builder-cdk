import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { FlowLogTrafficType, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  IBuilderVpcStyle,
  IBuildVpcProvides,
  IVpcWorkloadProps,
} from "./types";
import { BuilderVpc } from "./abstract-buildervpc";
import * as ram from "aws-cdk-lib/aws-ram";

// export interface IVpcWorkloadIsolatedProps extends IBuilderVpcProps {
//     createSubnets: Array<SubnetNamedMasks>
//     organizationId?: string
// }

export class VpcWorkloadIsolatedStack extends BuilderVpc {
  vpcStyle: IBuilderVpcStyle = "workloadIsolated";
  props: IVpcWorkloadProps;
  provides: IBuildVpcProvides = "workload";
  tgwCreateTgwSubnets: boolean = false;

  constructor(scope: Construct, id: string, props: IVpcWorkloadProps) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-vpc-workload`.toLowerCase();

    const vpcProps: ec2.VpcProps = {
      ipAddresses: ec2.IpAddresses.cidr(this.props.vpcCidr),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [],
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
        DDB: {
          service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        },
      },
    };

    props.createSubnets.forEach((createSubnet) => {
      vpcProps.subnetConfiguration?.push({
        name: createSubnet.name.toLowerCase(),
        cidrMask: createSubnet.cidrMask,
        subnetType: SubnetType.PRIVATE_ISOLATED,
      });
      this.privateIsolatedSubnetNames.push(createSubnet.name.toLowerCase());
    });

    this.vpc = new ec2.Vpc(this, this.name, vpcProps);
    this.vpc.addFlowLog("VpcFlowLogs", {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: FlowLogTrafficType.ALL,
    });

    this.props.createSubnets.forEach((createSubnet) => {
      if (createSubnet.sharedWith) {
        new ram.CfnResourceShare(this, `RamShare${createSubnet.name}`, {
          allowExternalPrincipals: false,
          name: `Share-${createSubnet.name}`,
          permissionArns: [
            "arn:aws:ram::aws:permission/AWSRAMDefaultPermissionSubnet",
          ],
          principals: this.ramPrincipals(createSubnet.sharedWith),
          resourceArns: this.subnetArnsByName(createSubnet.name),
        });
      }
    });
  }

  subnetArnsByName(subnetName: string) {
    const subnetArns: Array<string> = [];
    this.vpc
      .selectSubnets({ subnetGroupName: subnetName })
      .subnets.forEach((subnet) => {
        const subnetId = (subnet as ec2.Subnet).subnetId;
        subnetArns.push(
          `arn:aws:ec2:${this.region}:${this.account}:subnet/${subnetId}`
        );
      });
    return subnetArns;
  }

  ramPrincipals(sharedWithList: Array<string | number>) {
    const ramPrincipals: Array<string> = [];
    // AWS Account Identifier
    for (const sharedWith of sharedWithList) {
      if (Number.isInteger(sharedWith)) {
        ramPrincipals.push(`${sharedWith}`);
      } else {
        const sharedWithString = sharedWith.toString();
        let organizationMainAccountId = this.props.organizationMainAccountId
        // Historically we could use the deployment accounts ID to form our OU ARN.  That no longer works
        // However we want to allow users to annotate existing VPCs to use this old approach to not trigger an update
        if(this.props.legacyRamShare) {
          organizationMainAccountId = this.account
        }
        // Entire Organization share
        if (sharedWithString.startsWith("o-")) {
          ramPrincipals.push(
            `arn:aws:organizations::${organizationMainAccountId}/${sharedWith}`
          );
        } else if (sharedWithString.startsWith("ou-")) {
          if (this.props.organizationId) {
            ramPrincipals.push(
              `arn:aws:organizations::${organizationMainAccountId}:ou/${this.props.organizationId}/${sharedWith}`
            );
          }
        } else {
          throw new Error(
            `SharedWith contained string: ${sharedWithString} which could not be mapped`
          );
        }
      }
    }
    return ramPrincipals;
  }
}
