/*
 * NOTE: There is no Cloudformation support for Direct Connect at the moment.  This will serve as an abstract model
 * so we can import the tgw attachments and create static routes and propagations
 * See: https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/876
 * Expand in the future to support creation of the Dx Gateway itself when support is added.
 */

import { Construct } from "constructs";
import {
  IBuilderDxGwProps,
} from "./types";
import { BuilderDxGw } from "./abstract-builderdxgw";

export interface IDirectConnectGatewayProps extends IBuilderDxGwProps {
  existingTransitGatewayId: string;
  existingDxGwTransitGatewayAttachId: string
  existingDxGwTransitGatewayRouteTableId: string
}

export class DirectConnectGatewayStack extends BuilderDxGw {
  props: IDirectConnectGatewayProps;

  constructor(scope: Construct, id: string, props: IDirectConnectGatewayProps) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-dxgw`.toLowerCase();

    this.tgw = {
      attrId: this.props.existingTransitGatewayId
    }
    this.tgwRouteTable = {
      ref: this.props.existingDxGwTransitGatewayRouteTableId,
    };
    this.tgwAttachment = {
      attrId: this.props.existingDxGwTransitGatewayAttachId,
    };
  }
}
