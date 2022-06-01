import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as anfw from "aws-cdk-lib/aws-networkfirewall";
import * as cr from "aws-cdk-lib/custom-resources";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import {
  ITgw,
  IBuilderVpcProps,
  IBuilderVpcStyle,
  IBuildVpcProvides,
  ICustomResourceParseAwsFirewallEndpoints,
} from "./types";
import { BuilderVpc } from "./abstract-buildervpc";

export interface IVpcAwsNetworkFirewallProps extends IBuilderVpcProps {
  tgw: ITgw;
  firewallName: string;
  firewallDescription: string;
  firewallPolicyArn?: string;
}

export class VpcAwsNetworkFirewallStack extends BuilderVpc {
  vpcStyle: IBuilderVpcStyle = "awsNetworkFirewall";
  vpcInspects: boolean = true;
  withTgw: boolean = true;
  provides: IBuildVpcProvides = "firewall";
  props: IVpcAwsNetworkFirewallProps;
  firewallPolicy: anfw.CfnFirewallPolicy;
  firewall: anfw.CfnFirewall;
  firewallPolicyArn: string;

  constructor(
    scope: Construct,
    id: string,
    props: IVpcAwsNetworkFirewallProps
  ) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-provider-firewall`.toLowerCase();

    this.vpc = new ec2.Vpc(this, this.name, {
      cidr: this.props.vpcCidr,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [
        {
          name: "firewall-services",
          cidrMask: 28,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        {
          name: "transit-gateway",
          cidrMask: 28,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    this.privateIsolatedSubnetNames.push(
      ...["firewall-services", "transit-gateway"]
    );

    if (this.props.firewallPolicyArn) {
      this.firewallPolicyArn = this.props.firewallPolicyArn;
    } else {
      this.buildFirewallPolicy();
      this.firewallPolicyArn = this.firewallPolicy.attrFirewallPolicyArn;
    }

    this.firewall = new anfw.CfnFirewall(this, props.firewallName, {
      firewallName: this.props.firewallName,
      description: this.props.firewallDescription,
      firewallPolicyArn: this.firewallPolicyArn,
      subnetMappings: this.vpc
        .selectSubnets({ subnetGroupName: "firewall-services" })
        .subnetIds.map((subnetId) => {
          return { subnetId: subnetId };
        }),
      vpcId: this.vpc.vpcId,
    });

    const endpointParserBackend = new cr.Provider(
      this,
      "EndpointParserBackend",
      {
        onEventHandler: new nodeLambda.NodejsFunction(
          this,
          "FirewallEndpointParser",
          {
            entry: "lambda/parseAwsFirewallEndpoints/index.ts",
            handler: "onEvent",
          }
        ),
      }
    );

    // Network firewall 'helpfully' returns an unordered array with a string mapping of availability zone
    // to interface.  No easy way to manipulate this to get a route associated in CloudFormation so I'll use
    // a custom resource to return the interface ID for each AZ.
    // If you've got a clever way to do this wout a custom resource please let me know!
    props.availabilityZones.forEach((availabilityZone) => {
      const properties: ICustomResourceParseAwsFirewallEndpoints = {
        availabilityZone: availabilityZone,
        firewallEndpoints: this.firewall.attrEndpointIds,
      };
      const mappedEndpoint = new cdk.CustomResource(
        this,
        `EndpointParser${availabilityZone}`,
        {
          properties: properties,
          serviceToken: endpointParserBackend.serviceToken,
        }
      );
      this.vpc
        .selectSubnets({
          subnetGroupName: "transit-gateway",
        })
        .subnets.forEach((subnet) => {
          if (subnet.availabilityZone == availabilityZone) {
            new ec2.CfnRoute(this, `RouteToNFW-${availabilityZone}`, {
              routeTableId: (subnet as ec2.Subnet).routeTable.routeTableId,
              destinationCidrBlock: "0.0.0.0/0",
              vpcEndpointId: mappedEndpoint.getAttString("endpointId"),
            });
          }
        });
    });
  }

  buildFirewallPolicy() {
    // This creates basically what you'd get in the AWS Console by clicking through the defaults
    this.firewallPolicy = new anfw.CfnFirewallPolicy(this, "FirewallPolicy", {
      firewallPolicyName: `${this.props.firewallName}-policy`,
      description: `${this.props.firewallDescription} Policy`,
      firewallPolicy: {
        statelessRuleGroupReferences: [],
        statelessDefaultActions: ["aws:forward_to_sfe"],
        statelessFragmentDefaultActions: ["aws:forward_to_sfe"],
        statelessCustomActions: [],
        statefulRuleGroupReferences: [],
        statefulEngineOptions: {
          ruleOrder: "DEFAULT_ACTION_ORDER",
        },
      },
    });
  }
}
