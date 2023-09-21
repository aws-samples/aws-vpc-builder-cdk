import { Template, Match, Capture } from "aws-cdk-lib/assertions";
import {
  newVpcInterfaceEndpointsStack,
  newVpcWorkloadStack,
} from "./stack-builder-helper";
import { ITgw } from "../lib/types";
import * as cdk from "aws-cdk-lib";

const interfaceList = [
  "com.amazonaws.us-east-1.ec2",
  "com.amazonaws.us-east-1.ec2messages",
  "com.amazonaws.us-east-1.ssm",
  "com.amazonaws.us-east-1.ssmmessages",
  "com.amazonaws.us-east-1.kms",
];

test("InterfaceEndpointsBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const interfaceEndpoints = newVpcInterfaceEndpointsStack(
      {},
      app,
      interfaceList,
      ITgwedId
    );
    interfaceEndpoints.saveTgwRouteInformation();
    interfaceEndpoints.attachToTGW();
    interfaceEndpoints.createSsmParameters();
    const template = Template.fromStack(interfaceEndpoints);
    // We've provided 2 AZ so expect to see 4 subnets.  2 for Transit, and 2 for hosting our endpoints
    template.resourceCountIs("AWS::EC2::Subnet", 4);

    // Public subnets do not exist
    expect(interfaceEndpoints.publicSubnetNames).toEqual([]);
    // Private subnet (NATed) do not exist
    expect(interfaceEndpoints.privateSubnetNames).toEqual([]);
    // Two private isolated subnets, one for interface endpoints and another for the transit gateway
    expect(interfaceEndpoints.privateIsolatedSubnetNames).toEqual([
      "interface-endpoints",
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

    // We expect route53 private hosted zones for each interface we asked for with our dependency tree in place to rate limit
    for (const interfaceName of interfaceList) {
      const interfaceDnsName =
        interfaceEndpoints.lookupPrivateDnsName(interfaceName);
      template.hasResource("AWS::Route53::HostedZone", {
        Properties: {
          Name: `${interfaceDnsName}.`,
          // Shared with a single vpc (self)
          VPCs: [Match.anyValue()],
        },
        DependsOn: Match.anyValue(),
      });
      template.hasResource("AWS::Route53::RecordSet", {
        Properties: { Name: `${interfaceDnsName}.` },
        DependsOn: Match.anyValue(),
      });
      template.hasResource("AWS::EC2::VPCEndpoint", {
        Properties: {
          // We're creating the hosted zones ourselves.
          PrivateDnsEnabled: false,
          // Attached to two subnets
          SubnetIds: [Match.anyValue(), Match.anyValue()],
        },
        DependsOn: Match.anyValue(),
      });
    }

    // We expect SSM named exports within our construct are prepared with Transit Route Table, and Association.
    expect(interfaceEndpoints.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-endpoint-service-interface/tgwId"
    );
    expect(interfaceEndpoints.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-provider-endpoint-service-interface/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-provider-endpoint-service-interface/vpcId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/vpcCidr`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/az0`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/az1`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/interface-endpoints/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/subnets/transit-gateway/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/tgwAttachId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/tgwRouteId`,
      `${prefix}/vpcs/test-provider-endpoint-service-interface/tgwId`,
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: parameterName,
      });
    }
  }
});

test("InterfaceEndpointSpecifyCidrMask", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const interfaceEndpoints = newVpcInterfaceEndpointsStack(
      {
        perSubnetCidrMask: 26,
      },
      app,
      interfaceList,
      ITgwedId
    );
    interfaceEndpoints.saveTgwRouteInformation();
    interfaceEndpoints.attachToTGW();
    interfaceEndpoints.createSsmParameters();
    const template = Template.fromStack(interfaceEndpoints);

    // Subnets for InterfaceEndpoints should be /26 as specified
    const interfaceSubnetCapture = new Capture();
    template.hasResourceProperties("AWS::EC2::Subnet", {
      CidrBlock: interfaceSubnetCapture,
      Tags: Match.arrayWith([
        {
          Key: "aws-cdk:subnet-name",
          Value: "interface-endpoints",
        },
      ]),
    });
    expect(interfaceSubnetCapture.asString().split("/")[1]).toEqual("26");

    // Subnets for TransitGateway should remain /28
    const transitGatewaySubnetCapture = new Capture();
    template.hasResourceProperties("AWS::EC2::Subnet", {
      CidrBlock: transitGatewaySubnetCapture,
      Tags: Match.arrayWith([
        {
          Key: "aws-cdk:subnet-name",
          Value: "transit-gateway",
        },
      ]),
    });
    expect(transitGatewaySubnetCapture.asString().split("/")[1]).toEqual("28");
  }
});

test("InterfaceEndpointSharedWithVpc", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    // we will need a candidate workload VPC to share with.  Let's initialize one simply
    const shareEndpointsWith = newVpcWorkloadStack(
      {},
      app,
      "workloadIsolated",
      ITgwedId
    );
    shareEndpointsWith.saveTgwRouteInformation();
    shareEndpointsWith.attachToTGW();
    shareEndpointsWith.createSsmParameters();
    const interfaceEndpoints = newVpcInterfaceEndpointsStack(
      {
        interfaceEndpointSharedWithVpcs: [{ attachTo: shareEndpointsWith }],
      },
      app,
      interfaceList,
      shareEndpointsWith.tgw
    );
    interfaceEndpoints.saveTgwRouteInformation();
    interfaceEndpoints.attachToTGW();
    interfaceEndpoints.createSsmParameters();
    const template = Template.fromStack(interfaceEndpoints);

    // Our Private hosted zone should now reflect two VPC attachments to serve (self and shared)
    for (const interfaceName of interfaceList) {
      const interfaceDnsName =
        interfaceEndpoints.lookupPrivateDnsName(interfaceName);
      template.hasResource("AWS::Route53::HostedZone", {
        Properties: {
          Name: `${interfaceDnsName}.`,
          // Shared with Two VPCs now (self plus our one provided to constructor)
          VPCs: [Match.anyValue(), Match.anyValue()],
        },
        DependsOn: Match.anyValue(),
      });
    }
  }
});

test("InterfaceEndpointsNotInAllAZs", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    // We will add an AZ that we know doesn't exist expecting an error that we don't have coverage in that AZ for the endpoints we've requested
    expect(() => {
      const interfaceEndpoints = newVpcInterfaceEndpointsStack(
          {
            availabilityZones: ["us-east-1a", "us-east-1z"]
          },
          app,
          interfaceList,
          ITgwedId
      );
      interfaceEndpoints.saveTgwRouteInformation();
      interfaceEndpoints.attachToTGW();
      interfaceEndpoints.createSsmParameters();
    }).toThrow(
      "Endpoint com.amazonaws.us-east-1.ec2 is not available in all Availability Zones: us-east-1a,us-east-1z"
    )
  }
});