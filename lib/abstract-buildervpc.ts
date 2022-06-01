import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  IBuilderTgwStaticRoutes,
  IBuilderVpc,
  IBuilderVpcStyle,
  ITgwAttachType,
  IBuilderVpcProps,
  IVpcParameterModel,
  ITgwPropagateRouteAttachmentName,
  IBuildVpcProvides,
  ssmParameterImport,
  ITgw,
  ITgwRouteTable,
  ITgwAttachment,
} from "./types";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";

export abstract class BuilderVpc extends cdk.Stack implements IBuilderVpc {
  vpc: ec2.Vpc;
  vpcStyle: IBuilderVpcStyle;
  provides: IBuildVpcProvides;
  vpcInspects: boolean = false;
  publicSubnetNames: Array<string> = [];
  privateSubnetNames: Array<string> = [];
  privateIsolatedSubnetNames: Array<string> = [];
  ssmParameterPaths: IVpcParameterModel;
  globalPrefix: string;
  name: string;
  withTgw: boolean = false;
  tgwAttachType: ITgwAttachType = "vpc";
  tgw: ITgw;
  tgwCreateTgwSubnets: boolean = true;
  tgwAttachment: ITgwAttachment;
  tgwAttachmentSsm: ssmParameterImport;
  tgwRouteTable: ITgwRouteTable;
  tgwRouteTableSsm: ssmParameterImport;
  tgwPropagateRouteAttachmentNames: Array<ITgwPropagateRouteAttachmentName> =
    [];
  tgwBlackHoleCidrs: Array<string> = [];
  tgwStaticRoutes: Array<IBuilderTgwStaticRoutes> = [];
  tgwDefaultRouteAttachmentName: ITgwPropagateRouteAttachmentName;
  props: IBuilderVpcProps;

  protected constructor(scope: Construct, id: string, props: IBuilderVpcProps) {
    super(scope, id, props);
    this.props = props;
    this.globalPrefix = props.globalPrefix.toLowerCase();
  }

  saveTgwRouteInformation() {
    // Sometimes we will declare withTgw true and ignore props
    if (this.props.withTgw || this.withTgw) {
      this.withTgw = this.props.withTgw as boolean;
      if (!this.props.tgw) {
        throw new Error(
          `When property 'withTgw' is set to true, a 'tgw' must be specified as well.`
        );
      }
      this.tgw = this.props.tgw;
      // Save off any other routing based material we got in our constructor.  We will implement after TGW Attach
      if (this.props.tgwPropagateRouteAttachmentNames) {
        this.tgwPropagateRouteAttachmentNames.push(
          ...this.props.tgwPropagateRouteAttachmentNames
        );
      }
      if (this.props.tgwBlackHoleCidrs) {
        this.tgwBlackHoleCidrs.push(...this.props.tgwBlackHoleCidrs);
      }
      if (this.props.tgwStaticRoutes) {
        this.tgwStaticRoutes.push(...this.props.tgwStaticRoutes);
      }
      // Finally if we've been provided a default attachment to send traffic to, save it
      if (this.props.tgwDefaultRouteAttachmentName) {
        this.tgwDefaultRouteAttachmentName =
          this.props.tgwDefaultRouteAttachmentName;
      }
    }
  }

  async init() {}

  attachToTGW() {
    if (this.props.withTgw && this.props.tgw) {
      // Attachment to our TGW first.  If we're permitted to make a TGW specific subnet, use that.
      let subnetGroupName = "transit-gateway";
      // Not permitted to use a custom transit gateway subnet, use isolated followed by private
      if (!this.tgwCreateTgwSubnets) {
        if (this.privateIsolatedSubnetNames) {
          subnetGroupName = this.privateIsolatedSubnetNames[0];
        } else if (this.privateSubnetNames) {
          subnetGroupName = this.privateSubnetNames[0];
        } else {
          throw new Error(
            `Vpc ${this.name} attaching to TGW.  tgwCreateTgwSubnets is false but unable to find suitable private subnets to attach to`
          );
        }
      }
      this.tgwAttachment = new ec2.CfnTransitGatewayVpcAttachment(
        this,
        `TGWAttachment-${this.name}`,
        {
          vpcId: this.vpc.vpcId,
          transitGatewayId: this.tgw.attrId,
          tags: [{ key: "Name", value: this.name }],
          subnetIds: this.vpc.selectSubnets({
            subnetGroupName: subnetGroupName,
          }).subnetIds,
        }
      );
      // One route able per attachment
      this.tgwRouteTable = new ec2.CfnTransitGatewayRouteTable(
        this,
        `TGWRouteTable-${this.name}`,
        {
          transitGatewayId: this.tgw.attrId,
          tags: [{ key: "Name", value: this.name }],
        }
      );
      // Associate the route table with our attachment
      new ec2.CfnTransitGatewayRouteTableAssociation(
        this,
        `TGWRTAssoc-${this.name}`,
        {
          transitGatewayAttachmentId: this.tgwAttachment.attrId,
          transitGatewayRouteTableId: this.tgwRouteTable.ref,
        }
      );
    }
  }
  /*
    For VPC: vpcName must be known
    For Subnet: subnetName and Availability Zone must be known

    networking/vpcs/{vpcName}
     vpcId:
     vpcCidr:
     az1  ....  vpc/az2:
     tgwAttachId:
     tgwRouteId:
     subnets/{subnetName}
       {availabilityZone}/
         subnetId:
         subnetCidr:
         routeTableId:

     */
  createSsmParameters() {
    const prefix =
      `${this.props.ssmParameterPrefix}/networking/${this.globalPrefix}/vpcs/${this.name}`.toLowerCase();
    this.ssmParameterPaths = {
      vpcName: this.name,
      vpcId: `${prefix}/vpcId`,
      vpcCidr: `${prefix}/vpcCidr`,
      availabilityZones: this.availabilityZones,
      subnets: [],
    };
    new ssm.StringParameter(this, "ssmVpcId", {
      parameterName: this.ssmParameterPaths.vpcId,
      stringValue: this.vpc.vpcId,
    });
    new ssm.StringParameter(this, "ssmVpcCidr", {
      parameterName: this.ssmParameterPaths.vpcCidr,
      stringValue: this.vpc.vpcCidrBlock,
    });
    this.props.availabilityZones.forEach((availabilityZone, index) => {
      new ssm.StringParameter(this, `ssmVpcAz${index}`, {
        parameterName: `${prefix}/az${index}`,
        stringValue: availabilityZone,
      });
    });
    this.publicSubnetNames.forEach((subnetName) => {
      this.ssmSubnetParameterBuilder(subnetName, prefix);
    });
    this.privateSubnetNames.forEach((subnetName) => {
      this.ssmSubnetParameterBuilder(subnetName, prefix);
    });
    this.privateIsolatedSubnetNames.forEach((subnetName) => {
      this.ssmSubnetParameterBuilder(subnetName, prefix);
    });

    if (this.withTgw && this.tgw) {
      this.ssmParameterPaths.tgwAttachId = `${prefix}/tgwAttachId`;
      this.ssmParameterPaths.tgwRouteId = `${prefix}/tgwRouteId`;
      this.ssmParameterPaths.tgwId = `${prefix}/tgwId`;
      new ssm.StringParameter(this, "tgwAttachId", {
        parameterName: this.ssmParameterPaths.tgwAttachId,
        stringValue: this.tgwAttachment.attrId,
      });
      this.tgwAttachmentSsm = {
        name: this.ssmParameterPaths.tgwId,
      };
      new ssm.StringParameter(this, "tgwRouteId", {
        parameterName: this.ssmParameterPaths.tgwRouteId,
        stringValue: this.tgwRouteTable.ref,
      });
      this.tgwRouteTableSsm = {
        name: this.ssmParameterPaths.tgwRouteId,
      };
      new ssm.StringParameter(this, "tgwId", {
        parameterName: this.ssmParameterPaths.tgwId,
        stringValue: this.tgw.attrId,
      });
    }
  }

  ssmSubnetParameterBuilder(subnetName: string, prefix: string) {
    this.vpc
      .selectSubnets({ subnetGroupName: subnetName })
      .subnets.forEach((subnet, index) => {
        const subnetPrefix = `${prefix}/subnets/${subnetName}/${subnet.availabilityZone}`;
        this.ssmParameterPaths.subnets.push({
          availabilityZone: subnet.availabilityZone,
          routeTableId: `${subnetPrefix}/routeTableId`,
          subnetCidr: `${subnetPrefix}/subnetCidr`,
          subnetId: `${subnetPrefix}/subnetId`,
          subnetName: subnetName,
        });
        new ssm.StringParameter(
          this,
          `ssmVpcSubnetAz${subnetName}${index}RouteTableId`,
          {
            parameterName: `${subnetPrefix}/routeTableId`,
            stringValue: subnet.routeTable.routeTableId,
          }
        );
        new ssm.StringParameter(
          this,
          `ssmVpcSubnetAz${subnetName}${index}SubnetCidr`,
          {
            parameterName: `${subnetPrefix}/subnetCidr`,
            stringValue: (subnet as ec2.Subnet).ipv4CidrBlock,
          }
        );
        new ssm.StringParameter(
          this,
          `ssmVpcSubnetAz${subnetName}${index}subnetId`,
          {
            parameterName: `${subnetPrefix}/subnetId`,
            stringValue: (subnet as ec2.Subnet).subnetId,
          }
        );
      });
  }

  get availabilityZones(): string[] {
    return this.props.availabilityZones;
  }
}
