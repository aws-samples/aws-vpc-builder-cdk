import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import {
  ITransitGatewayProvides,
  ITransitGatewayStyle,
  ITransitGatewayBaseProps,
} from "./types";
import { TransitGateway } from "./abstract-transitgateway";

export interface ITransitGatewayProps extends ITransitGatewayBaseProps {
  amazonSideAsn?: number;
}

export class TransitGatewayStack extends TransitGateway {
  name: string;
  props: ITransitGatewayProps;
  tgwStyle: ITransitGatewayStyle = "transitGateway";
  provides: ITransitGatewayProvides = "transitGateway";
  tgw: ec2.CfnTransitGateway;

  constructor(scope: Construct, id: string, props: ITransitGatewayProps) {
    super(scope, id, props);

    this.props = props;
    this.name = `${props.namePrefix}-transit-gateway`.toLowerCase();

    this.tgw = new ec2.CfnTransitGateway(this, "TransitGateway", {
      amazonSideAsn: props.amazonSideAsn ? props.amazonSideAsn : 65521,
      autoAcceptSharedAttachments: "enable",
      defaultRouteTableAssociation: "disable",
      defaultRouteTablePropagation: "disable",
      vpnEcmpSupport: "enable",
      description: props.tgwDescription,
      tags: [
        {
          key: "Name",
          value: this.name,
        },
      ],
    });
  }
}
