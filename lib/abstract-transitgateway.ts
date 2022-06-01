import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ITransitGatewayBase,
  ITransitGatewayProvides,
  ITransitGatewayStyle,
  ITransitGatewayBaseProps,
} from "./types";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export abstract class TransitGateway
  extends cdk.Stack
  implements ITransitGatewayBase
{
  name: string;
  props: ITransitGatewayBaseProps;
  tgwStyle: ITransitGatewayProvides;
  provides: ITransitGatewayStyle;
  tgw: ec2.CfnTransitGateway;

  protected constructor(
    scope: Construct,
    id: string,
    props: ITransitGatewayBaseProps
  ) {
    super(scope, id, props);
  }

  async init() {}
}
