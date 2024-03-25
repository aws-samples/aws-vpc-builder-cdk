import { Template } from "aws-cdk-lib/assertions";
import { newTgwPeerStack } from "./stack-builder-helper";
import * as cdk from "aws-cdk-lib";

// This stack is just a placeholder for SSM parameters to support our Transit Gateway Route creation etc.
// Confirm our SSM parameters are created and the correct path/value.
test("SsmParametersCreated", () => {
  const app = new cdk.App();
  const dxStack = newTgwPeerStack({}, app)
  dxStack.saveTgwRouteInformation();
  dxStack.attachToTGW();
  dxStack.createSsmParameters();
  const template = Template.fromStack(dxStack);

  // We expect SSM Exports that our stacks above can consume:
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/ssm/prefix/networking/globalprefix/tgwpeer/test-tgwpeer/tgwRouteId",
    Value: "tgw-rtb-678910",
  });
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/ssm/prefix/networking/globalprefix/tgwpeer/test-tgwpeer/tgwAttachId",
    Value: "tgw-attach-678910",
  });
})
