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

// export interface IVpcWorkloadPublicProps extends IBuilderVpcProps {
//     createSubnets: Array<SubnetNamedMasks>
//     organizationId?: string
// }

export class VpcWorkloadPublicStack extends BuilderVpc {
  vpcStyle: IBuilderVpcStyle = "workloadPublic";
  props: IVpcWorkloadProps;
  provides: IBuildVpcProvides = "workload";
  tgwCreateTgwSubnets: boolean = false;

  constructor(scope: Construct, id: string, props: IVpcWorkloadProps) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-vpc-public-workload`.toLowerCase();

    const vpcProps: ec2.VpcProps = {
      ipAddresses: ec2.IpAddresses.cidr(this.props.vpcCidr),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: this.props.availabilityZones.length,
      subnetConfiguration: [],
    };

    props.createSubnets.forEach((createSubnet) => {
      vpcProps.subnetConfiguration?.push({
        name: createSubnet.name.toLowerCase(),
        cidrMask: createSubnet.cidrMask,
        subnetType: SubnetType.PUBLIC,
      });
      this.publicSubnetNames.push(createSubnet.name.toLowerCase());
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
        // Entire Organization share
        if (sharedWithString.startsWith("o-")) {
          ramPrincipals.push(
            `arn:aws:organizations::${this.account}/${sharedWith}`
          );
        } else if (sharedWithString.startsWith("ou-")) {
          if (this.props.organizationId) {
            ramPrincipals.push(
              `arn:aws:organizations::${this.account}:ou/${this.props.organizationId}/${sharedWith}`
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
