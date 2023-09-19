import { Template } from "aws-cdk-lib/assertions";
import {
  TransitGatewayRoutesStack,
} from "../lib/transit-gateway-routes-stack";
import {
  newAwsNetworkFirewallStack,
  newVpcWorkloadStack,
    newDxGwStack
} from "./stack-builder-helper";
import * as cdk from "aws-cdk-lib";
const md5 = require("md5");

const twoWorkloadVpcs = (app: cdk.App) => {
  const firstVpc = newVpcWorkloadStack(
    {
      namePrefix: "FirstVpc",
      vpcCidr: "10.1.0.0/16",
    },
    app,
    "workloadIsolated"
  );
  firstVpc.saveTgwRouteInformation();
  firstVpc.attachToTGW();
  firstVpc.createSsmParameters();

  // ** Second VPC that routes back to first.
  const secondVpc = newVpcWorkloadStack(
    {
      namePrefix: "SecondVpc",
      vpcCidr: "10.2.0.0/16",
    },
    app,
    "workloadIsolated",
    firstVpc.tgw
  );
  secondVpc.saveTgwRouteInformation();
  secondVpc.attachToTGW();
  secondVpc.createSsmParameters();

  return [firstVpc, secondVpc];
};

const createDxGw = (app: cdk.App) => {
  const dxStack = newDxGwStack({}, app)
  dxStack.saveTgwRouteInformation();
  dxStack.attachToTGW();
  dxStack.createSsmParameters();

  return dxStack
};

// Black Hole Routes
test("TgwRouteBlackhole", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  // Set our Blockhole
  firstVpc.tgwBlackHoleCidrs.push("10.10.0.0/16");

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Confirm our blackhole route is set on the TGW for our attachment
  const routeId = "BlackHole" + md5(`${firstVpc.name}-10.10.0.0/16`);
  expect(templateJson.Resources).toMatchObject({
    [routeId]: {
      Type: "AWS::EC2::TransitGatewayRoute",
      Properties: expect.anything(),
    },
  });
});

// A dynamic route between VPCs (a propagation)
test("TgwRouteDynamic", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  // Set our relationship between the VPCs
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: secondVpc,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();
  // Confirm we get an association both ways
  const firstRouteId =
    `TGWPropRoute${firstVpc.name}to${secondVpc.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
      Properties: expect.anything(),
    },
  });

  const secondRouteId =
    `TGWPropRoute${secondVpc.name}to${firstVpc.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [secondRouteId]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
      Properties: expect.anything(),
    },
  });
});

// A dynamic route from a VPC to a DxGw (a propagation)
test("TgwRouteDynamicToDxGw", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const dxgw = createDxGw(app)
  // Set our relationship between the VPCs
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: dxgw,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc, dxgw],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();
  // Confirm we get an association both ways
  const firstRouteId =
      `TGWPropRoute${firstVpc.name}to${dxgw.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
      Properties: expect.anything(),
    },
  });

  const secondRouteId =
      `TGWPropRoute${firstVpc.name}to${dxgw.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [secondRouteId]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
      Properties: expect.anything(),
    },
  });
});

// A static route between VPCs
test("TgwStaticDynamic", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  // Set our relationship between the VPCs
  firstVpc.tgwStaticRoutes.push({
    cidrAddress: "10.1.2.1/24",
    attachTo: secondVpc,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Confirm our static route is in place and pointing to our custom resource for handling
  const firstRouteId =
    "StaticRouteCR" + md5(`${firstVpc.name}-10.1.2.1/24-${secondVpc.name}`);
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "10.1.2.1/24",
      },
    },
  });
});

// A static route to a DxGw
test("TgwStaticVpcToDxGw", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const dxgw = createDxGw(app)
  // Set our relationship between the VPCs
  firstVpc.tgwStaticRoutes.push({
    cidrAddress: "10.1.2.1/24",
    attachTo: dxgw,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc, dxgw],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Confirm our static route is in place and pointing to our custom resource for handling
  const firstRouteId =
      "StaticRouteCR" + md5(`${firstVpc.name}-10.1.2.1/24-${dxgw.name}`);
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "10.1.2.1/24",
      },
    },
  });
});

// A default route between VPCs
test("TgwStatic", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  // First default routes to second
  firstVpc.tgwDefaultRouteAttachmentName = {
    attachTo: secondVpc,
  };

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Confirm our default route is in place
  const firstRouteId = "TGWDefaultCR" + md5(firstVpc.tgwRouteTableSsm.name);
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "0.0.0.0/0",
      },
    },
  });
});

// A default route from a VPC to a DxGw
test("TgwDefaultRouteVpcToDxGw", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const dxgw = createDxGw(app)
  // Set our relationship between the VPCs
  firstVpc.tgwDefaultRouteAttachmentName = {
    attachTo: dxgw,
  };

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc, dxgw],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();
  // Confirm our default route is in place
  const firstRouteId = "TGWDefaultCR" + md5(firstVpc.tgwRouteTableSsm.name);
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "0.0.0.0/0",
        // this is the attachment identifier of the DxGw
        transitGatewayAttachmentId: "tgw-attach-12345"
      },
    },
  });
});

// A dynamic route between VPCs that is inspected
// Inspect:  Forward: Source -> Static CIDR of Dest -> Inspect.  Inspect -> Propagation -> Dest.
//           Return: Dest -> Static CIDR of Source -> Inspect.  Inspect -> Propagation -> Source
test("TgwDynamicWithInspect", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const firewallStack = newAwsNetworkFirewallStack({}, app, firstVpc.tgw);
  firewallStack.saveTgwRouteInformation();
  firewallStack.attachToTGW();
  firewallStack.createSsmParameters();

  // First routes to second, with inspection by firewall
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: secondVpc,
    inspectBy: firewallStack,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc, firewallStack],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // FirstVpc will have a static route to secondVpc pointing to the Firewall attachment
  const firstToFirewallStatic =
    `TGWInspectionStaticRouteCR-${firstVpc.name}-to-${secondVpc.name}`.replace(
      /-/g,
      ""
    );
  expect(templateJson.Resources).toMatchObject({
    [firstToFirewallStatic]: {
      Type: "AWS::CloudFormation::CustomResource",
    },
  });
  expect(templateJson.Resources[firstToFirewallStatic].Properties).toEqual(
    expect.objectContaining({
      transitGatewayAttachmentId: {
        "Fn::ImportValue": expect.stringContaining("firewall"),
      },
      transitGatewayRouteTableId: {
        Ref: expect.stringContaining("firstvpc"),
      },
    })
  );
  // Second will have a static to First pointing to the Firewall attachment
  const secondToFirewallStatic =
    `TGWInspectionStaticRouteCR-${secondVpc.name}to${firstVpc.name}`.replace(
      /-/g,
      ""
    );
  expect(templateJson.Resources).toMatchObject({
    [secondToFirewallStatic]: {
      Type: "AWS::CloudFormation::CustomResource",
    },
  });
  expect(templateJson.Resources[secondToFirewallStatic].Properties).toEqual(
    expect.objectContaining({
      transitGatewayAttachmentId: {
        "Fn::ImportValue": expect.stringContaining("firewall"),
      },
      transitGatewayRouteTableId: {
        Ref: expect.stringContaining("secondvpc"),
      },
    })
  );
  // Now four dynamic associations.  Firewall <-> First and Firewall <-> Second
  const firewallToFirst =
    `TGWPropRoute${firewallStack.name}to${firstVpc.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [firewallToFirst]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
    },
  });
  const firewallToSecond =
    `TGWPropRoute${firewallStack.name}to${secondVpc.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [firewallToSecond]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
    },
  });
  const firstToFirewall =
    `TGWPropRoute${firstVpc.name}to${firewallStack.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [firstToFirewall]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
    },
  });
  const secondToFirewall =
    `TGWPropRoute${secondVpc.name}to${firewallStack.name}`.replace(/-/g, "");
  expect(templateJson.Resources).toMatchObject({
    [secondToFirewall]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
    },
  });
});

// A default route between VPCs and a Dyanmic route that has inspection prefers the dynamic route (Deafult route should not be created)
test("TgwInspectOverridesDefault", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const firewallStack = newAwsNetworkFirewallStack({}, app, firstVpc.tgw);
  firewallStack.saveTgwRouteInformation();
  firewallStack.attachToTGW();
  firewallStack.createSsmParameters();

  // First default routes to second
  firstVpc.tgwDefaultRouteAttachmentName = {
    attachTo: secondVpc,
  };
  // Also have an inspected relationship
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: secondVpc,
    inspectBy: firewallStack,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Default route should not exist
  const firstRouteId = "TGWDefaultCR" + md5(firstVpc.tgwRouteTableSsm.name);
  expect(templateJson.Resources).not.toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "0.0.0.0/0",
      },
    },
  });
});

// Where there are two dynamic routes between vpcs but on requires inspection, default to inspect
test("TgwInspectIsPreferred", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  const firewallStack = newAwsNetworkFirewallStack({}, app, firstVpc.tgw);
  firewallStack.saveTgwRouteInformation();
  firewallStack.attachToTGW();
  firewallStack.createSsmParameters();

  // relatinoship that should be inspected
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: secondVpc,
    inspectBy: firewallStack,
  });
  // But also one that shouldn't be
  secondVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: firstVpc,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // FirstVpc will have a static route to secondVpc pointing to the Firewall attachment
  const firstToFirewallStatic =
    `TGWInspectionStaticRouteCR-${firstVpc.name}-to-${secondVpc.name}`.replace(
      /-/g,
      ""
    );
  expect(templateJson.Resources).toMatchObject({
    [firstToFirewallStatic]: {
      Type: "AWS::CloudFormation::CustomResource",
    },
  });
  expect(templateJson.Resources[firstToFirewallStatic].Properties).toEqual(
    expect.objectContaining({
      transitGatewayAttachmentId: {
        "Fn::ImportValue": expect.stringContaining("firewall"),
      },
      transitGatewayRouteTableId: {
        Ref: expect.stringContaining("firstvpc"),
      },
    })
  );
  // Second will have a static to First pointing to the Firewall attachment
  const secondToFirewallStatic =
    `TGWInspectionStaticRouteCR-${secondVpc.name}to${firstVpc.name}`.replace(
      /-/g,
      ""
    );
  expect(templateJson.Resources).toMatchObject({
    [secondToFirewallStatic]: {
      Type: "AWS::CloudFormation::CustomResource",
    },
  });
  expect(templateJson.Resources[secondToFirewallStatic].Properties).toEqual(
    expect.objectContaining({
      transitGatewayAttachmentId: {
        "Fn::ImportValue": expect.stringContaining("firewall"),
      },
      transitGatewayRouteTableId: {
        Ref: expect.stringContaining("secondvpc"),
      },
    })
  );
});

// Where a dynamic route and default route exist to the same target, the default route is preferred
test("TgwDefaultOverridesDynamic", () => {
  const app = new cdk.App();
  const [firstVpc, secondVpc] = twoWorkloadVpcs(app);

  // First default routes to second
  firstVpc.tgwDefaultRouteAttachmentName = {
    attachTo: secondVpc,
  };
  // Also have an dynamic relationship
  firstVpc.tgwPropagateRouteAttachmentNames.push({
    attachTo: secondVpc,
  });

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firstVpc, secondVpc],
  });

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // Default route should exist
  const firstRouteId = "TGWDefaultCR" + md5(firstVpc.tgwRouteTableSsm.name);
  expect(templateJson.Resources).toMatchObject({
    [firstRouteId]: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: {
        destinationCidrBlock: "0.0.0.0/0",
      },
    },
  });
  // Dynamic route should not exist
  expect(templateJson.Resources).not.toMatchObject({
    [firstRouteId]: {
      Type: "AWS::EC2::TransitGatewayRouteTablePropagation",
      Properties: expect.anything(),
    },
  });
});
