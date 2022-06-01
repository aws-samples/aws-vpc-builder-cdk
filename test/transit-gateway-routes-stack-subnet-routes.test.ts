import { Template, Match } from "aws-cdk-lib/assertions";
import {
  TransitGatewayRoutesStack,
  ITransitGatewayRoutesProps,
} from "../lib/transit-gateway-routes-stack";
import {
  newAwsNetworkFirewallStack,
  newNatEgressStack,
  newVpcInterfaceEndpointsStack,
  newVpcRoute53ResolverStack,
  newVpcWorkloadStack,
} from "./stack-builder-helper";
import { IBuilderVpc } from "../lib/types";
import * as cdk from "aws-cdk-lib";
const md5 = require("md5");

const interfaceList = [
  "com.amazonaws.us-east-1.ec2",
  "com.amazonaws.us-east-1.ec2messages",
  "com.amazonaws.us-east-1.ssm",
  "com.amazonaws.us-east-1.ssmmessages",
  "com.amazonaws.us-east-1.kms",
];

// type subnetRouteStyles = "defaultEndpoint" | "defaultFirewall" | "defaultTgwworkload" |

const routesAllBackToTgw = (stack: IBuilderVpc, routeStack: cdk.Stack) => {
  const template = Template.fromStack(routeStack);
  // Template has a default route back to a transit Gateway
  template.hasResourceProperties("AWS::EC2::Route", {
    DestinationCidrBlock: "0.0.0.0/0",
    TransitGatewayId: Match.anyValue(),
  });
  const templateJson = template.toJSON();
  // confirm the Identifier of the route matches our default
  stack.ssmParameterPaths.subnets.forEach((subnet) => {
    const routeId = `ToTGWDefault${md5(subnet.routeTableId)}`;
    // const routeId = "toTGWCidr" + md5(`${stack.name}${subnet.subnetCidr}DefaultToTGW`)
    expect(templateJson.Resources).toMatchObject({
      [routeId]: expect.anything(),
    });
  });
};

// Firewall Subnet TGW routing:
//  - Style awsNetworkFirewall - 'firewall-services' Subnets (NOT Transit Gateway Subnets) -> Default back to TGW
test("ProviderFirewallAwsNetworkFirewallSubnets", () => {
  const app = new cdk.App();
  const firewallStack = newAwsNetworkFirewallStack({}, app);
  firewallStack.saveTgwRouteInformation();
  firewallStack.attachToTGW();
  firewallStack.createSsmParameters();
  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [firewallStack],
  });
  const template = Template.fromStack(routeStack);
  // Two AZs, only two subnet routes present
  template.resourceCountIs("AWS::EC2::Route", 2);
  // Route is a default route back to a transit Gateway
  template.hasResourceProperties("AWS::EC2::Route", {
    DestinationCidrBlock: "0.0.0.0/0",
    TransitGatewayId: Match.anyValue(),
  });
  const firewallSubnets = firewallStack.ssmParameterPaths.subnets.filter(
    (subnet) => subnet.subnetName == "firewall-services"
  );

  // Identifiers for our ec2 routes match what we expect to generate
  const templateJson = template.toJSON();
  const routeOneId = `ToTGWDefault${md5(firewallSubnets[0].routeTableId)}`;
  const routeTwoId = `ToTGWDefault${md5(firewallSubnets[1].routeTableId)}`;
  expect(templateJson.Resources).toMatchObject({
    [routeOneId]: expect.anything(),
  });
  expect(templateJson.Resources).toMatchObject({
    [routeTwoId]: expect.anything(),
  });
});

// Internet TGW subnet Routing
//  - Style natEgress - Public Subnets (NOT Transit Gateway Subnets) -> Route workload back to TGW
//  - There is NO default route installed to TGW as it needs to default to the IGW.  Just workload CIDRs
test("ProviderInternetNatEgressSubnets", () => {
  const app = new cdk.App();
  // ** Egress Stack
  const natEgressStack = newNatEgressStack({}, app);
  natEgressStack.saveTgwRouteInformation();
  natEgressStack.attachToTGW();
  natEgressStack.createSsmParameters();

  // ** Candidate workload to route back to
  const workloadStack = newVpcWorkloadStack(
    {
      // Default route to our NAT Egress
      tgwDefaultRouteAttachmentName: {
        attachTo: natEgressStack,
      },
    },
    app,
    "workloadIsolated",
    natEgressStack.tgw
  );
  workloadStack.saveTgwRouteInformation();
  workloadStack.attachToTGW();
  workloadStack.createSsmParameters();
  // Routes stack
  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [natEgressStack, workloadStack],
  });

  const netGatewaySubnets = natEgressStack.ssmParameterPaths.subnets.filter(
    (subnet) => subnet.subnetName == "nat-egress"
  );
  const workloadCidr = workloadStack.ssmParameterPaths.vpcCidr;
  const template = Template.fromStack(routeStack);
  // Our AZ count is 4.  Two for our workload back to TGW, and Two for our NatEgress stack
  template.resourceCountIs("AWS::EC2::Route", 4);
  const templateJson = template.toJSON();
  // Confirm routes back from the NAT VPC to the CIDRs for our workload exists and uses our naming scheme.
  const routeOneId =
    "toTGWCidr" +
    md5(
      `${natEgressStack.name}${netGatewaySubnets[0].subnetCidr}${workloadCidr}`
    );
  const routeTwoId =
    "toTGWCidr" +
    md5(
      `${natEgressStack.name}${netGatewaySubnets[1].subnetCidr}${workloadCidr}`
    );
  expect(templateJson.Resources).toMatchObject({
    [routeOneId]: expect.anything(),
  });
  expect(templateJson.Resources).toMatchObject({
    [routeTwoId]: expect.anything(),
  });
});

// Endpoint Service Interface Endpoints subnet Routing
//  - Style serviceInterfaceEndpoint - All Subnets back to TGW
test("ProviderServiceInterfaceEndpointSubnets", () => {
  const app = new cdk.App();
  // ** Egress Stack
  const serviceInterfaceStack = newVpcInterfaceEndpointsStack(
    {},
    app,
    interfaceList
  );
  serviceInterfaceStack.saveTgwRouteInformation();
  serviceInterfaceStack.attachToTGW();
  serviceInterfaceStack.createSsmParameters();

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [serviceInterfaceStack],
  });

  routesAllBackToTgw(serviceInterfaceStack, routeStack);
});

// Endpoint Route53 Resolver Endpoints subnet Routing
//  - Style route53ResolverEndpoint - All Subnets back to TGW
test("ProviderRoute53ResolverEndpointSubnets", () => {
  const app = new cdk.App();
  // ** Egress Stack
  const resolverEndpointStack = newVpcRoute53ResolverStack({}, app);
  resolverEndpointStack.saveTgwRouteInformation();
  resolverEndpointStack.attachToTGW();
  resolverEndpointStack.createSsmParameters();

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [resolverEndpointStack],
  });

  routesAllBackToTgw(resolverEndpointStack, routeStack);
});

// VPC Workload Isolated subnet Routing
//  - Style workloadIsolated - Any route in place simply routes back to the TGW for handling.
test("VpcWorkloadIsolatedDefaultRoutesSubnets", () => {
  const app = new cdk.App();
  // ** First VPC
  const workloadIsolatedStack = newVpcWorkloadStack(
    {},
    app,
    "workloadIsolated"
  );
  workloadIsolatedStack.saveTgwRouteInformation();
  workloadIsolatedStack.attachToTGW();
  workloadIsolatedStack.createSsmParameters();

  // ** Second VPC that routes back to first.
  const workloadRoutesToStack = newVpcWorkloadStack(
    {
      namePrefix: "ToRouteTo",
      vpcCidr: "10.20.0.0/16",
    },
    app,
    "workloadIsolated",
    workloadIsolatedStack.tgw
  );
  workloadRoutesToStack.saveTgwRouteInformation();
  workloadRoutesToStack.attachToTGW();
  workloadRoutesToStack.createSsmParameters();

  workloadIsolatedStack.tgwDefaultRouteAttachmentName = {
    attachTo: workloadRoutesToStack,
  };

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [workloadIsolatedStack, workloadRoutesToStack],
  });

  // Both should default route to the TGW so they can speak to each other
  routesAllBackToTgw(workloadIsolatedStack, routeStack);
  routesAllBackToTgw(workloadRoutesToStack, routeStack);
});

// VPC Workload Public subnet Routing
//  - Style workloadPublic - Speicifc routes go back to the TGW for handling so our IGW route isn't stomped on.
test("VpcWorkloadPublicRoutesSubnets", () => {
  const app = new cdk.App();
  // ** First VPC - we'll use public so we can observe routes directly to each other and no default routes
  const workloadPublicOne = newVpcWorkloadStack({}, app, "workloadPublic");
  workloadPublicOne.saveTgwRouteInformation();
  workloadPublicOne.attachToTGW();
  workloadPublicOne.createSsmParameters();

  // ** Second VPC - use public routes back to first.
  const workloadPublicStack = newVpcWorkloadStack(
    {
      namePrefix: "ToRouteTo",
      vpcCidr: "10.20.0.0/16",
    },
    app,
    "workloadPublic",
    workloadPublicOne.tgw
  );
  workloadPublicStack.saveTgwRouteInformation();
  workloadPublicStack.attachToTGW();
  workloadPublicStack.createSsmParameters();

  // Create our association which will set a dynamic route to the TGW for the VPC CIDRs
  workloadPublicStack.tgwPropagateRouteAttachmentNames.push({
    attachTo: workloadPublicOne,
  });
  // Create a static route to a CIDR so we can observe this route going to the TGW as well
  workloadPublicStack.tgwStaticRoutes.push({
    attachTo: workloadPublicOne,
    cidrAddress: "172.16.0.0/16",
  });
  // We will try and force a default route between these public subnets to assure it doesn't actually happen
  // There are additional protections in the config parser, but this is a reasonable second layer to test
  workloadPublicStack.tgwDefaultRouteAttachmentName = {
    attachTo: workloadPublicOne,
  };

  const routeStack = new TransitGatewayRoutesStack(app, "RouteStack", {
    tgwAttachmentsAndRoutes: [workloadPublicStack, workloadPublicOne],
  });

  const publicSubnets = workloadPublicStack.ssmParameterPaths.subnets.filter(
    (subnet) => subnet.subnetName == "testing"
  );

  const template = Template.fromStack(routeStack);
  const templateJson = template.toJSON();

  // 2 x static routes left, 2 x dynamic routes left, 2 x dynamic routes right
  template.resourceCountIs("AWS::EC2::Route", 6);

  // No default routes in our TGW stack since we've used entirely public subnets, even though we've declared one above
  template.hasResourceProperties("AWS::EC2::Route", {
    DestinationCidrBlock: Match.not("0.0.0.0/0"),
  });

  const workloadPublicOneCidr = workloadPublicOne.ssmParameterPaths.vpcCidr;

  // Confirm we have dynamic route
  const dynamicRouteOneId =
    "toTGWCidr" +
    md5(
      `${workloadPublicStack.name}${publicSubnets[0].subnetCidr}${workloadPublicOneCidr}`
    );
  const dynamicRouteTwoId =
    "toTGWCidr" +
    md5(
      `${workloadPublicStack.name}${publicSubnets[1].subnetCidr}${workloadPublicOneCidr}`
    );
  expect(templateJson.Resources).toMatchObject({
    [dynamicRouteOneId]: expect.anything(),
  });
  expect(templateJson.Resources).toMatchObject({
    [dynamicRouteTwoId]: expect.anything(),
  });
  // Confirm we have static routes
  const staticRouteOneId =
    "toTGWCidr" +
    md5(
      `${workloadPublicStack.name}172.16.0.0/16${publicSubnets[0].routeTableId}`
    );
  const staticRouteTwoId =
    "toTGWCidr" +
    md5(
      `${workloadPublicStack.name}172.16.0.0/16${publicSubnets[1].routeTableId}`
    );
  expect(templateJson.Resources).toMatchObject({
    [staticRouteOneId]: expect.anything(),
  });
  expect(templateJson.Resources).toMatchObject({
    [staticRouteTwoId]: expect.anything(),
  });
});
