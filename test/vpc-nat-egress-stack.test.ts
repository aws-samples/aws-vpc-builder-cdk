import { Template } from "aws-cdk-lib/assertions";
import { newNatEgressStack } from "./stack-builder-helper";
import * as cdk from "aws-cdk-lib";
import { ITgw } from "../lib/types";

test("NatEgressStackBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    const natEgress = newNatEgressStack(
      {
        globalPrefix: "globalPrefix",
        ssmParameterPrefix: "/ssm/prefix",
        namePrefix: "Test",
        availabilityZones: ["us-east-1a", "us-east-1b"],
      },
      app,
      tgwImportedId
    );
    natEgress.saveTgwRouteInformation();
    natEgress.attachToTGW();
    natEgress.createSsmParameters();
    const template = Template.fromStack(natEgress);
    // We've provided 2 AZ so expect to see 4 subnets.  2 for Transit, and 2 for our other AZs
    template.resourceCountIs("AWS::EC2::Subnet", 4);

    // Public subnets exist
    expect(natEgress.publicSubnetNames).toEqual(["nat-egress"]);
    // Private subnet exists with NAT services attached (by the route stack) to the TGW
    expect(natEgress.privateSubnetNames).toEqual(["transit-gateway"]);
    // We expect private isolated subnets are empty.
    expect(natEgress.privateIsolatedSubnetNames).toEqual([]);

    // We expect NAT, and IGW resources exist (one per AZ)
    template.resourceCountIs("AWS::EC2::NatGateway", 2);
    template.resourceCountIs("AWS::EC2::InternetGateway", 1);

    // We expect to have associated to the Transit Gateway and Created a Route Table
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      1
    );
    template.resourceCountIs("AWS::EC2::TransitGatewayRouteTable", 1);
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      1
    );

    // We expect SSM named exports within our construct are prepared with Transit Route Table, and Association.
    expect(natEgress.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-internet/tgwId"
    );
    expect(natEgress.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-internet/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-provider-internet/vpcId`,
      `${prefix}/vpcs/test-provider-internet/vpcCidr`,
      `${prefix}/vpcs/test-provider-internet/az0`,
      `${prefix}/vpcs/test-provider-internet/az1`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-internet/subnets/nat-egress/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-internet/subnets/transit-gateway/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-internet/tgwAttachId`,
      `${prefix}/vpcs/test-provider-internet/tgwRouteId`,
      `${prefix}/vpcs/test-provider-internet/tgwId`,
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: parameterName,
      });
    }
  }
});
