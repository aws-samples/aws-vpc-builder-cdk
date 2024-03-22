import { Construct } from "constructs";
import {
  IBuilderTgwPeerProps,
} from "./types";
import {BuilderTgwPeer} from "./abstract-buildertgwpeer";

export interface ITransitGatewayPeerProps extends IBuilderTgwPeerProps {
  existingTransitGatewayId: string;
  existingPeerTransitGatewayAttachId: string
  existingPeerTransitGatewayRouteTableId: string
}

export class TransitGatewayPeerStack extends BuilderTgwPeer {
  props: ITransitGatewayPeerProps;

  constructor(scope: Construct, id: string, props: ITransitGatewayPeerProps) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-tgwPeer`.toLowerCase();
    this.withTgw = true;
    this.tgw = {
      attrId: this.props.existingTransitGatewayId
    }
    this.tgwRouteTable = {
      ref: this.props.existingPeerTransitGatewayRouteTableId,
    };
    this.tgwAttachment = {
      attrId: this.props.existingPeerTransitGatewayAttachId,
    };
  }
}
