import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  IBuilderTgwStaticRoutes,
  IBuilderTgwPeer,
  IBuilderTgwPeerProps,
  ITgwAttachType,
  ITgwPropagateRouteAttachmentName,
  ssmParameterImport,
  ITgw,
  ITgwRouteTable,
  ITgwAttachment,
} from "./types";
import * as ssm from "aws-cdk-lib/aws-ssm";

export abstract class BuilderTgwPeer extends cdk.Stack implements IBuilderTgwPeer {
  name: string;
  globalPrefix: string;
  // Always attached to a Transit Gateway
  withTgw: true;
  // Always false since this isn't VPC Based
  tgwCreateTgwSubnets: false;
  tgwAttachType: ITgwAttachType = "tgwPeer"
  tgw: ITgw;
  tgwRouteTable: ITgwRouteTable;
  tgwRouteTableSsm: ssmParameterImport;
  tgwAttachment: ITgwAttachment;
  tgwAttachmentSsm: ssmParameterImport;
  tgwPropagateRouteAttachmentNames: Array<ITgwPropagateRouteAttachmentName> =
    [];
  // Blackhole CIDRs not applicable for an imported peer connection
  readonly tgwBlackHoleCidrs: [];
  tgwStaticRoutes: Array<IBuilderTgwStaticRoutes> = [];
  tgwDefaultRouteAttachmentName: ITgwPropagateRouteAttachmentName;
  props: IBuilderTgwPeerProps;

  protected constructor(scope: Construct, id: string, props: IBuilderTgwPeerProps) {
    super(scope, id, props);
    this.props = props;
    this.globalPrefix = props.globalPrefix.toLowerCase();
  }

  // We only support imports, but this method is common to all stacks so needs to be present
  saveTgwRouteInformation() {
  }

  async init() {}

  createSsmParameters() {
    const prefix =
      `${this.props.ssmParameterPrefix}/networking/${this.globalPrefix}/tgwPeer/${this.name}`.toLowerCase();

    this.tgwRouteTableSsm = {
      name: `${prefix}/tgwRouteId`,
    };
    new ssm.StringParameter(this, `ssmTgwPeerTgwRouteTableSsm`, {
      parameterName: `${prefix}/tgwRouteId`,
      stringValue: this.tgwRouteTable.ref,
    });

    this.tgwAttachmentSsm = {
      name: `${prefix}/tgwAttachId`,
    };
    new ssm.StringParameter(this, `ssmTgwPeerTgwAttachIdSsm`, {
      parameterName: `${prefix}/tgwAttachId`,
      stringValue: this.tgwAttachment.attrId,
    });
  }

  // We only support imports, but this method is common to all stacks so needs to be present
  attachToTGW() {
  }
}
