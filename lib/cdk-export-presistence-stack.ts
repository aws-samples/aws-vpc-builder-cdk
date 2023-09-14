import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuilderVpc } from "./abstract-buildervpc";
import {IBuilderDxGw, IBuilderVpc, IBuilderVpn} from "./types";

export interface ICdkExportPersistenceProps extends cdk.StackProps {
  persistExports: Array<IBuilderVpc | IBuilderVpn | IBuilderDxGw>;
}

export class CdkExportPersistenceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ICdkExportPersistenceProps) {
    super(scope, id, props);

    // We will just create outputs for our saved exports from underlying stacks so we can assure
    // they will always exist and allow the CDK to understand relationships/orders between stacks.
    props.persistExports.forEach((persistExports) => {
      if (persistExports instanceof BuilderVpc) {
        new cdk.CfnOutput(this, `${persistExports.name}-vpcId`, {
          value: persistExports.vpc.vpcId,
        });
      }
      if (persistExports.withTgw) {
        new cdk.CfnOutput(this, `${persistExports.name}}-tgwAttachmentId`, {
          value: persistExports.tgwAttachment.attrId,
        });
        new cdk.CfnOutput(this, `${persistExports.name}-tgwId`, {
          value: persistExports.tgw.attrId,
        });
      }
    });
  }
}
