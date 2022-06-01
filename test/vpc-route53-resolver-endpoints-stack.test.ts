import { Template, Match } from "aws-cdk-lib/assertions";
import {
  newVpcRoute53ResolverStack,
  newVpcWorkloadStack,
} from "./stack-builder-helper";
import { ITgw } from "../lib/types";
import * as cdk from "aws-cdk-lib";

test("Route53ResolverBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const resolverEndpoints = newVpcRoute53ResolverStack(
      {
        resolveRequestsFromCidrs: ["10.0.0.0/8"],
        forwardRequests: {
          forDomains: ["amclean.org"],
          toIps: ["10.10.1.2"],
        },
      },
      app,
      ITgwedId
    );
    resolverEndpoints.saveTgwRouteInformation();
    resolverEndpoints.attachToTGW();
    resolverEndpoints.createSsmParameters();
    const template = Template.fromStack(resolverEndpoints);
    // We've provided 2 AZ so expect to see 4 subnets.  2 for Transit, and 2 for hosting our endpoints
    template.resourceCountIs("AWS::EC2::Subnet", 4);

    // Public subnets do not exist
    expect(resolverEndpoints.publicSubnetNames).toEqual([]);
    // Private subnet (NATed) do not exist
    expect(resolverEndpoints.privateSubnetNames).toEqual([]);
    // Two private isolated subnets, one for interface endpoints and another for the transit gateway
    expect(resolverEndpoints.privateIsolatedSubnetNames).toEqual([
      "resolver-endpoints",
      "transit-gateway",
    ]);

    // We expect NAT, and IGW resources do Not exist
    expect(() => template.hasResource("AWS::EC2::NatGateway", {})).toThrow();
    expect(() =>
      template.hasResource("AWS::EC2::InternetGateway", {})
    ).toThrow();

    // We expect to have associated to the Transit Gateway and Created a Route Table
    template.resourceCountIs("AWS::EC2::TransitGatewayVpcAttachment", 1);
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      1
    );
    template.resourceCountIs("AWS::EC2::TransitGatewayRouteTable", 1);

    // We expect an Inbound and Outbound resolver
    template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
      Properties: {
        Direction: "INBOUND",
      },
    });
    template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
      Properties: {
        Direction: "OUTBOUND",
      },
    });
    // Security group that permits inbound on 53 udp and tcp to our resolveRequestFromCidrs
    template.hasResource("AWS::EC2::SecurityGroup", {
      Properties: {
        SecurityGroupIngress: [
          {
            CidrIp: "10.0.0.0/8",
            Description: "Resolver TCP DNS Query from 10.0.0.0/8",
            FromPort: 53,
            IpProtocol: "tcp",
            ToPort: 53,
          },
          {
            CidrIp: "10.0.0.0/8",
            Description: "Resolver UDP DNS Query from 10.0.0.0/8",
            FromPort: 53,
            IpProtocol: "udp",
            ToPort: 53,
          },
        ],
      },
    });
    // We expect a forward rule to mclean.org
    template.hasResource("AWS::Route53Resolver::ResolverRule", {
      Properties: {
        RuleType: "FORWARD",
        DomainName: "amclean.org",
        TargetIps: [
          {
            Ip: "10.10.1.2",
            Port: "53",
          },
        ],
      },
    });
    // With an association
    template.resourceCountIs(
      "AWS::Route53Resolver::ResolverRuleAssociation",
      1
    );
    // We expect SSM named exports within our construct are prepared with Transit Route Table, and Association.
    expect(resolverEndpoints.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-endpoint-route53-resolver/tgwId"
    );
    expect(resolverEndpoints.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-endpoint-route53-resolver/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/vpcId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/vpcCidr`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/az0`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/az1`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/resolver-endpoints/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/subnets/transit-gateway/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/tgwAttachId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/tgwRouteId`,
      `${prefix}/vpcs/test-provider-endpoint-route53-resolver/tgwId`,
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: parameterName,
      });
    }
  }
});

test("Route53ResolverOnlyInbound", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const resolverEndpoints = newVpcRoute53ResolverStack(
      {
        resolveRequestsFromCidrs: ["10.0.0.0/8"],
      },
      app,
      ITgwedId
    );
    resolverEndpoints.saveTgwRouteInformation();
    resolverEndpoints.attachToTGW();
    resolverEndpoints.createSsmParameters();
    const template = Template.fromStack(resolverEndpoints);

    // We expect an Inbound resolver
    template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
      Properties: {
        Direction: "INBOUND",
      },
    });
    // But not an outbound resolver
    expect(() => {
      template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
        Properties: {
          Direction: "OUTBOUND",
        },
      });
    }).toThrow();
  }
});

test("Route53ResolverOnlyOutbound", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const resolverEndpoints = newVpcRoute53ResolverStack(
      {
        forwardRequests: {
          forDomains: ["amclean.org"],
          toIps: ["10.10.1.2"],
        },
      },
      app,
      ITgwedId
    );
    resolverEndpoints.saveTgwRouteInformation();
    resolverEndpoints.attachToTGW();
    resolverEndpoints.createSsmParameters();
    const template = Template.fromStack(resolverEndpoints);

    // We expect an outbound resolver
    template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
      Properties: {
        Direction: "OUTBOUND",
      },
    });
    // But not an inbound resolver
    expect(() => {
      template.hasResource("AWS::Route53Resolver::ResolverEndpoint", {
        Properties: {
          Direction: "INBOUND",
        },
      });
    }).toThrow();
  }
});

test("Route53ResolverExternalVpcs", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const resolverEndpoints = newVpcRoute53ResolverStack(
      {
        forwardRequests: {
          forDomains: ["amclean.org"],
          toIps: ["10.10.1.2"],
          forExistingVpcs: [
            {
              name: "importedVpc",
              vpcId: "vpc-1234",
            },
          ],
        },
      },
      app,
      ITgwedId
    );
    resolverEndpoints.saveTgwRouteInformation();
    resolverEndpoints.attachToTGW();
    resolverEndpoints.createSsmParameters();
    const template = Template.fromStack(resolverEndpoints);

    // Expect our association will contain our imported vpc
    template.hasResourceProperties(
      "AWS::Route53Resolver::ResolverRuleAssociation",
      {
        VPCId: "vpc-1234",
      }
    );
  }
});

test("Route53ResolverAssociatedVpcs", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const workloadStack = newVpcWorkloadStack(
      {},
      app,
      "workloadIsolated",
      ITgwedId
    );
    workloadStack.saveTgwRouteInformation();
    workloadStack.attachToTGW();
    workloadStack.createSsmParameters();

    const resolverEndpoints = newVpcRoute53ResolverStack(
      {
        forwardRequests: {
          forDomains: ["amclean.org"],
          toIps: ["10.10.1.2"],
          forVpcs: [workloadStack],
        },
      },
      app,
      workloadStack.tgw
    );
    resolverEndpoints.saveTgwRouteInformation();
    resolverEndpoints.attachToTGW();
    resolverEndpoints.createSsmParameters();
    const template = Template.fromStack(resolverEndpoints);

    // Expect our association will contain a reference to our existing VPC an explicit ID
    template.hasResourceProperties(
      "AWS::Route53Resolver::ResolverRuleAssociation",
      {
        VPCId: { Ref: Match.anyValue() },
      }
    );
  }
});
