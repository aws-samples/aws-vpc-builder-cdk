import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as r53r from "aws-cdk-lib/aws-route53resolver";
const md5 = require("md5");

import {
  IBuilderVpcProps,
  IBuilderVpcStyle,
  IBuildVpcProvides,
  ITgwAttachType,
  ITgw,
  IBuilderVpc,
} from "./types";
import { IConfigProviderRoute53EndpointsForExistingVpcs } from "./config/config-types";
import { BuilderVpc } from "./abstract-buildervpc";

interface forwardRequestsProps {
  forDomains: Array<string>;
  toIps: Array<string>;
  forVpcs?: Array<IBuilderVpc>;
  forExistingVpcs?: Array<IConfigProviderRoute53EndpointsForExistingVpcs>;
}

export interface IVpcRoute53ResolverEndpointsProps extends IBuilderVpcProps {
  forwardRequests?: forwardRequestsProps;
  resolveRequestsFromCidrs?: Array<string>;
  // not supporting a non-transit gateway version of this
  tgw: ITgw;
}

export class VpcRoute53ResolverEndpointsStack extends BuilderVpc {
  vpc: ec2.Vpc;
  vpcStyle: IBuilderVpcStyle = "route53ResolverEndpoint";
  tgwAttachType: ITgwAttachType = "vpc";
  withTgw: boolean = true;
  provides: IBuildVpcProvides = "endpoints";
  props: IVpcRoute53ResolverEndpointsProps;
  inboundResolverSg: ec2.SecurityGroup;
  inboundResolver: r53r.CfnResolverEndpoint;
  outboundResolverSg: ec2.SecurityGroup;
  outboundResolver: r53r.CfnResolverEndpoint;

  constructor(
    scope: Construct,
    id: string,
    props: IVpcRoute53ResolverEndpointsProps
  ) {
    super(scope, id, props);

    // Build our Name
    this.name =
      `${props.namePrefix}-provider-endpoint-route53-resolver`.toLowerCase();
    this.createVpc();

    // CloudFormation will fail if our AZs are less than two.  We'll catch and throw about that here.
    if (props.availabilityZones.length < 2) {
      throw new Error(
        "To use Route53 Resolver Endpoints you must provide at least two availability zones"
      );
    }

    // Configure our inbound if present
    if (props.resolveRequestsFromCidrs) {
      this.createInboundResolverSg();
      let ipAddressProps: Array<r53r.CfnResolverEndpoint.IpAddressRequestProperty> =
        [];
      this.vpc
        .selectSubnets({ subnetGroupName: "resolver-endpoints" })
        .subnetIds.forEach((subnetId) => {
          ipAddressProps.push({ subnetId: subnetId });
        });
      this.inboundResolver = new r53r.CfnResolverEndpoint(
        this,
        "InboundResolver",
        {
          name: "InboundRoute53Resolver",
          direction: "INBOUND",
          ipAddresses: ipAddressProps,
          securityGroupIds: [this.inboundResolverSg.securityGroupId],
        }
      );
    }

    // Configure our outbound if present
    if (props.forwardRequests?.forDomains || props.forwardRequests?.toIps) {
      this.createOutboundResolverSg();
      let ipAddressProps: Array<r53r.CfnResolverEndpoint.IpAddressRequestProperty> =
        [];
      this.vpc
        .selectSubnets({ subnetGroupName: "resolver-endpoints" })
        .subnetIds.forEach((subnetId) => {
          ipAddressProps.push({ subnetId: subnetId });
        });
      this.outboundResolver = new r53r.CfnResolverEndpoint(
        this,
        "OutboundResolver",
        {
          direction: "OUTBOUND",
          ipAddresses: ipAddressProps,
          securityGroupIds: [this.outboundResolverSg.securityGroupId],
        }
      );
      // Now for the rules
      const targetIpsProps = props.forwardRequests.toIps.map((targetIp) => {
        return {
          ip: targetIp,
          port: "53",
        } as r53r.CfnResolverRule.TargetAddressProperty;
      });
      for (const domain of props.forwardRequests.forDomains) {
        const domainWithDash = domain.replace(".", "-");
        const resolveEndpoint = new r53r.CfnResolverRule(
          this,
          `resolverForwardRule-${md5(domain)}`,
          {
            name: `Forward-${domainWithDash}`,
            domainName: domain,
            resolverEndpointId: this.outboundResolver.attrResolverEndpointId,
            ruleType: "FORWARD",
            targetIps: targetIpsProps,
          }
        );

        new r53r.CfnResolverRuleAssociation(
          this,
          `resolverRuleAssociateSelf-${md5(domain)}`,
          {
            name: `${this.name}-association`,
            resolverRuleId: resolveEndpoint.attrResolverRuleId,
            vpcId: this.vpc.vpcId,
          }
        );
        // Associate the rule for any additional VPCs
        if (props.forwardRequests.forVpcs) {
          props.forwardRequests.forVpcs.forEach((vpc) => {
            // We need to use the config file name for our existing vpc since its a string literal.
            // Using a vpc.vpc.vpcId here would create a token that changes between synths and changes our resources.
            const ruleCfnId = `${vpc.name}${domain}`;
            new r53r.CfnResolverRuleAssociation(
              this,
              `resolverRuleAssociateVpc-${md5(ruleCfnId)}`,
              {
                name: `${vpc.name}-association`,
                resolverRuleId: resolveEndpoint.attrResolverRuleId,
                vpcId: vpc.vpc.vpcId,
              }
            );
          });
        }
        if (props.forwardRequests.forExistingVpcs) {
          props.forwardRequests.forExistingVpcs.forEach((vpc) => {
            // We can use the identifier in md5 since it is a string literal and won't change
            const ruleCfnId = `${vpc.vpcId}${domain}`;
            new r53r.CfnResolverRuleAssociation(
              this,
              `resolverRuleAssociateVpc-${md5(ruleCfnId)}`,
              {
                name: `${vpc.name}-association`,
                resolverRuleId: resolveEndpoint.attrResolverRuleId,
                vpcId: vpc.vpcId,
              }
            );
          });
        }
      }
    }
  }

  createVpc() {
    this.vpc = new ec2.Vpc(this, this.name, {
      cidr: this.props.vpcCidr,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [
        {
          name: "resolver-endpoints",
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
      ...["resolver-endpoints", "transit-gateway"]
    );
  }

  createInboundResolverSg() {
    this.inboundResolverSg = new ec2.SecurityGroup(this, "r53InboundResolver", {
      allowAllOutbound: true,
      description: "Security Group for Route53 Inbound Resolver",
      securityGroupName: "r53InboundResolver",
      vpc: this.vpc,
    });
    for (const inboundCidr of this.props.resolveRequestsFromCidrs!) {
      this.inboundResolverSg.addIngressRule(
        ec2.Peer.ipv4(inboundCidr),
        ec2.Port.tcp(53),
        `Resolver TCP DNS Query from ${inboundCidr}`
      );
      this.inboundResolverSg.addIngressRule(
        ec2.Peer.ipv4(inboundCidr),
        ec2.Port.udp(53),
        `Resolver UDP DNS Query from ${inboundCidr}`
      );
    }
  }

  createOutboundResolverSg() {
    // No ingress rules required since this is an outbound resolver only.
    this.outboundResolverSg = new ec2.SecurityGroup(
      this,
      "r53OutboundResolver",
      {
        allowAllOutbound: true,
        description: "Security Group for Route53 Outbound Resolver",
        securityGroupName: "r53OutboundResolver",
        vpc: this.vpc,
      }
    );
  }
}
