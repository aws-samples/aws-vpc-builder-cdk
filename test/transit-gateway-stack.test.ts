import { Template } from "aws-cdk-lib/assertions";

import {
  TransitGatewayStack,
  ITransitGatewayProps,
} from "../lib/transit-gateway-stack";
import * as cdk from "aws-cdk-lib";

const newTransitStack = (props: ITransitGatewayProps) => {
  const app = new cdk.App();
  return new TransitGatewayStack(app, "TransitGatewayStack", props);
};

test("BaseNoOptionalParams", () => {
  const transitStack = newTransitStack({
    namePrefix: "string",
    tgwDescription: "this is a description",
  });
  const template = Template.fromStack(transitStack);
  // One Transit Gateway resource
  template.resourceCountIs("AWS::EC2::TransitGateway", 1);
  // Default ASN we've embedded in our template
  template.findResources("AWS::EC2::TransitGateway", {
    AmazonSideAsn: 65521,
    Description: "this is a description",
  });
});

// We specify an ASN and it is accepted
test("SpecifyOurAsn", () => {
  const transitStack = newTransitStack({
    namePrefix: "string",
    tgwDescription: "this is a description",
    amazonSideAsn: 64000,
  });
  const template = Template.fromStack(transitStack);
  template.findResources("AWS::EC2::TransitGateway", {
    AmazonSideAsn: 64000,
  });
});
