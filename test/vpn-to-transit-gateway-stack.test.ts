import { Template, Match } from "aws-cdk-lib/assertions";
import { newVpnStack } from "./stack-builder-helper";
import * as cdk from "aws-cdk-lib";
import { ITgw } from "../lib/types";

test("BaseWithNewCustomerGateway", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    const vpnStack = newVpnStack(
      {
        newCustomerGatewayName: "testing",
        newCustomerGatewayAsn: 65321,
        newCustomerGatewayIpAddress: "1.2.3.4",
      },
      app,
      tgwImportedId
    );
    vpnStack.saveTgwRouteInformation();
    vpnStack.attachToTGW();
    vpnStack.createSsmParameters();
    const template = Template.fromStack(vpnStack);
    // One VPN Resource and a Customer Gateway Resource
    template.resourceCountIs("AWS::EC2::VPNConnection", 1);
    template.resourceCountIs("AWS::EC2::CustomerGateway", 1);
    // We expect to have associated to the Transit Gateway and Created a Route Table
    template.resourceCountIs("AWS::EC2::TransitGatewayRouteTable", 1);
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      1
    );
    // We expect our new customer gateway reflects the ASN, Address, and Name we specified
    template.hasResourceProperties("AWS::EC2::CustomerGateway", {
      IpAddress: "1.2.3.4",
      BgpAsn: 65321,
      Tags: [
        {
          Key: "Name",
          Value: "testing-customer-gateway",
        },
      ],
    });
    // We expect SSM Exports that our stacks above can consume:
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/ssm/prefix/networking/globalprefix/vpns/test-vpn/tgwRouteId",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/ssm/prefix/networking/globalprefix/vpns/test-vpn/tgwAttachId",
    });
  }
});

test("WithExistingCustomerGateway", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    const vpnStack = newVpnStack(
      {
        existingCustomerGatewayId: "cgw-123451",
      },
      app,
      tgwImportedId
    );
    vpnStack.saveTgwRouteInformation();
    vpnStack.attachToTGW();
    const template = Template.fromStack(vpnStack);
    // One VPN Resource and a Customer Gateway Resource
    template.resourceCountIs("AWS::EC2::VPNConnection", 1);
    template.resourceCountIs("AWS::EC2::CustomerGateway", 0);
    // Our VPN connection should have our provided customer gateway from above
    template.hasResourceProperties("AWS::EC2::VPNConnection", {
      CustomerGatewayId: "cgw-123451",
    });
  }
});

test("BaseWithImport", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    const vpnStack = newVpnStack(
      {
        existingVpnConnectionId: "vpn-1234",
        existingVpnTransitGatewayAttachId: "tgw-attach-1234",
        existingVpnTransitGatewayRouteTableId: "tgw-rtb-12313",
      },
      app,
      tgwImportedId
    );
    vpnStack.saveTgwRouteInformation();
    vpnStack.attachToTGW();
    vpnStack.createSsmParameters();
    const template = Template.fromStack(vpnStack);
    // Expect no resources created (Stack exists for SSM exports only)
    template.resourceCountIs("AWS::EC2::VPNConnection", 0);
    template.resourceCountIs("AWS::EC2::CustomerGateway", 0);
    // We expect to have associated to the Transit Gateway and Created a Route Table
    template.resourceCountIs("AWS::EC2::TransitGatewayRouteTable", 0);
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      0
    );
    // We expect our ref to vpn is working
    expect(vpnStack.vpn.ref).toEqual("vpn-1234");
    // We expect SSM Exports that our stacks above can consume:
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/ssm/prefix/networking/globalprefix/vpns/test-vpn/tgwRouteId",
      Value: "tgw-rtb-12313",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/ssm/prefix/networking/globalprefix/vpns/test-vpn/tgwAttachId",
      Value: "tgw-attach-1234",
    });
  }
});

test("BaseWithImportBadProps", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    // Confirm we throw if we're missing an import value
    expect(() =>
      newVpnStack(
        {
          existingVpnConnectionId: "vpn-1234",
          existingVpnTransitGatewayAttachId: "tgw-attach-1234",
        },
        app,
        tgwImportedId
      )
    ).toThrow(
      "Importing an existing VPN requires existingVpnTransitGatewayRouteTableId to be defined"
    );
  }
});

test("ExtraVpnPropertiesPresentButNotPSK", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let tgwImportedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      tgwImportedId = {
        attrId: "tgw-12392488",
      };
    }
    const vpnStack = newVpnStack(
      {
        existingCustomerGatewayId: "cgw-123451",
        tunnelOneOptions: {
          tunnelInsideCidr: "169.254.10.1/30",
        },
        tunnelTwoOptions: {
          tunnelInsideCidr: "169.254.11.1/30",
        },
      },
      app,
      tgwImportedId
    );
    vpnStack.saveTgwRouteInformation();
    vpnStack.attachToTGW();
    const template = Template.fromStack(vpnStack);
    // Our VPN connection should have our provided customer gateway from above
    template.hasResourceProperties("AWS::EC2::VPNConnection", {
      CustomerGatewayId: "cgw-123451",
      VpnTunnelOptionsSpecifications: [
        {
          TunnelInsideCidr: "169.254.10.1/30",
        },
        {
          TunnelInsideCidr: "169.254.11.1/30",
        },
      ],
    });

    // Fail our tests if someone implements the PSK in the template.  If you get this working safely / with s secret/secure string
    // Then you can remove this
    expect(() =>
      template.hasResourceProperties("AWS::EC2::VPNConnection", {
        VpnTunnelOptionsSpecifications: [
          {
            PreSharedKey: Match.anyValue(),
          },
          {
            PreSharedKey: Match.anyValue(),
          },
        ],
      })
    ).toThrow();
  }
});
