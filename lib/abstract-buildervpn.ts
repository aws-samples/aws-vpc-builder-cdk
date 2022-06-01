import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  IBuilderTgwStaticRoutes,
  IBuilderVpn,
  IBuilderVpnProps,
  ITgwAttachType,
  ITgwPropagateRouteAttachmentName,
  IBuilderVpnStyle,
  IBuilderVpnProvides,
  ssmParameterImport,
  ITgw,
  ITgwRouteTable,
  ITgwAttachment,
  IVpn,
} from "./types";
import { IConfigVpnTunnelOptions } from "./config/config-types";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";

export abstract class BuilderVpn extends cdk.Stack implements IBuilderVpn {
  name: string;
  globalPrefix: string;
  vpn: IVpn;
  vpnStyle: IBuilderVpnStyle;
  vpnProvides: IBuilderVpnProvides;
  tunnelOneOptions: IConfigVpnTunnelOptions;
  tunnelTwoOptions: IConfigVpnTunnelOptions;
  withTgw: boolean;
  tgwCreateTgwSubnets: boolean = true;
  tgwAttachType: ITgwAttachType;
  tgw: ITgw;
  tgwRouteTable: ITgwRouteTable;
  tgwRouteTableSsm: ssmParameterImport;
  tgwAttachment: ITgwAttachment;
  tgwAttachmentSsm: ssmParameterImport;
  tgwPropagateRouteAttachmentNames: Array<ITgwPropagateRouteAttachmentName> =
    [];
  tgwBlackHoleCidrs: Array<string> = [];
  tgwStaticRoutes: Array<IBuilderTgwStaticRoutes> = [];
  tgwDefaultRouteAttachmentName: ITgwPropagateRouteAttachmentName;
  props: IBuilderVpnProps;

  protected constructor(scope: Construct, id: string, props: IBuilderVpnProps) {
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

  createSsmParameters() {
    const prefix =
      `${this.props.ssmParameterPrefix}/networking/${this.globalPrefix}/vpns/${this.name}`.toLowerCase();

    this.tgwRouteTableSsm = {
      name: `${prefix}/tgwRouteId`,
    };
    new ssm.StringParameter(this, `ssmVpnTgwRouteTableSsm`, {
      parameterName: `${prefix}/tgwRouteId`,
      stringValue: this.tgwRouteTable.ref,
    });

    this.tgwAttachmentSsm = {
      name: `${prefix}/tgwAttachId`,
    };
    new ssm.StringParameter(this, `ssmVpnTgwAttachIdSsm`, {
      parameterName: `${prefix}/tgwAttachId`,
      stringValue: this.tgwAttachment.attrId,
    });
  }

  // We're already attached when created, but this will create our RouteTable and associate it unless we're dealing with an import
  attachToTGW() {
    if (this.props.withTgw && this.props.tgw) {
      // If our tgwRouteTable is already set due to import we will skip
      if (!this.tgwRouteTable) {
        this.tgwRouteTable = new ec2.CfnTransitGatewayRouteTable(
          this,
          `TGWRouteTable-${this.name}`,
          {
            transitGatewayId: this.tgw.attrId,
            tags: [{ key: "Name", value: this.name }],
          }
        );
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
  }
}
