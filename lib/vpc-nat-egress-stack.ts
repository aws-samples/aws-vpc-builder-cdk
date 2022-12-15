import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {
  IBuilderVpcProps,
  IBuilderVpcStyle,
  IBuildVpcProvides,
  ITgw,
} from "./types";
import { BuilderVpc } from "./abstract-buildervpc";

export interface IVpcNatEgressProps extends IBuilderVpcProps {
  // Pattern requires a TGW
  tgw: ITgw;
}

export class VpcNatEgressStack extends BuilderVpc {
  vpcStyle: IBuilderVpcStyle = "natEgress";
  props: IVpcNatEgressProps;
  withTgw: true;
  provides: IBuildVpcProvides = "internet";

  constructor(scope: Construct, id: string, props: IVpcNatEgressProps) {
    super(scope, id, props);
    this.props = props;
    this.name = `${props.namePrefix}-provider-internet`.toLowerCase();

    this.vpc = new ec2.Vpc(this, this.name, {
      ipAddresses: ec2.IpAddresses.cidr(this.props.vpcCidr),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [
        {
          name: "nat-egress",
          cidrMask: 28,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: "transit-gateway",
          cidrMask: 28,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });
    this.publicSubnetNames.push("nat-egress");
    // We're NATing our transit gateway connections, so we consider it a 'private' in this use-case.
    this.privateSubnetNames.push("transit-gateway");
  }
}
