import { Template } from "aws-cdk-lib/assertions";
import { newAwsNetworkFirewallStack } from "./stack-builder-helper";
import * as cdk from "aws-cdk-lib";
import { ITgw } from "../lib/types";

test("NetworkFirewallBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const awsFirewall = newAwsNetworkFirewallStack({}, app, ITgwedId);
    awsFirewall.saveTgwRouteInformation();
    awsFirewall.attachToTGW();
    awsFirewall.createSsmParameters();
    const template = Template.fromStack(awsFirewall);
    // We've provided 2 AZ so expect to see 4 subnets.  2 for Transit, and 2 our firewall
    template.resourceCountIs("AWS::EC2::Subnet", 4);

    // Public subnets do not exist
    expect(awsFirewall.publicSubnetNames).toEqual([]);
    // Private subnet (NATed) do not exist
    expect(awsFirewall.privateSubnetNames).toEqual([]);
    // Two private isolated subnets, one for firewall services and another for the transit gateway
    expect(awsFirewall.privateIsolatedSubnetNames).toEqual([
      "firewall-services",
      "transit-gateway",
    ]);

    // We expect NAT, and IGW resources do Not exist
    expect(() => template.hasResource("AWS::EC2::NatGateway", {})).toThrow();
    expect(() =>
      template.hasResource("AWS::EC2::InternetGateway", {})
    ).toThrow();

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
    expect(awsFirewall.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-firewall/tgwId"
    );
    expect(awsFirewall.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-firewall/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-provider-firewall/vpcId`,
      `${prefix}/vpcs/test-provider-firewall/vpcCidr`,
      `${prefix}/vpcs/test-provider-firewall/az0`,
      `${prefix}/vpcs/test-provider-firewall/az1`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-firewall/subnets/firewall-services/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-firewall/subnets/transit-gateway/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-firewall/tgwAttachId`,
      `${prefix}/vpcs/test-provider-firewall/tgwRouteId`,
      `${prefix}/vpcs/test-provider-firewall/tgwId`,
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: parameterName,
      });
    }
  }
});
