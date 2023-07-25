import { Template, Match } from "aws-cdk-lib/assertions";
import { newVpcWorkloadStack } from "./stack-builder-helper";
import { ITgw } from "../lib/types";
import * as cdk from "aws-cdk-lib";

test("WorkloadIsolatedBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const workloadIsolated = newVpcWorkloadStack(
      {
        globalPrefix: "globalPrefix",
        ssmParameterPrefix: "/ssm/prefix",
        namePrefix: "Test",
        vpcCidr: "10.1.0.0/16",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        withTgw: true,
        createSubnets: [
          {
            name: "testing",
            cidrMask: 21,
          },
        ],
      },
      app,
      "workloadIsolated",
      ITgwedId
    );
    workloadIsolated.saveTgwRouteInformation();
    workloadIsolated.attachToTGW();
    workloadIsolated.createSsmParameters();
    const template = Template.fromStack(workloadIsolated);
    // We've provided 2 AZs and left our transit gateway specific to default of false so expect to see 2 subnets.
    template.resourceCountIs("AWS::EC2::Subnet", 2);

    // Public subnets do not exist
    expect(workloadIsolated.publicSubnetNames).toEqual([]);
    // Private subnet (NATed) do not exist
    expect(workloadIsolated.privateSubnetNames).toEqual([]);
    // One total privated ioslated subnet
    expect(workloadIsolated.privateIsolatedSubnetNames).toEqual(["testing"]);

    // We expect NAT, and IGW resources do Not exist
    expect(() => template.hasResource("AWS::EC2::NatGateway", {})).toThrow();
    expect(() =>
      template.hasResource("AWS::EC2::InternetGateway", {})
    ).toThrow();

    // We'll have an s3 and DynamoDB Gateway endpoint
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      ServiceName: {
        "Fn::Join": [
          "",
          [
            "com.amazonaws.",
            {
              Ref: "AWS::Region",
            },
            ".s3",
          ],
        ],
      },
      VpcEndpointType: "Gateway",
    });
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      ServiceName: {
        "Fn::Join": [
          "",
          [
            "com.amazonaws.",
            {
              Ref: "AWS::Region",
            },
            ".dynamodb",
          ],
        ],
      },
      VpcEndpointType: "Gateway",
    });

    // We'll have VPC flow logs enabled for CloudWatch
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
    template.resourceCountIs("AWS::EC2::FlowLog", 1);

    // We expect to have associated to the Transit Gateway and Created a Route Table
    template.resourceCountIs("AWS::EC2::TransitGatewayVpcAttachment", 1);
    template.resourceCountIs(
      "AWS::EC2::TransitGatewayRouteTableAssociation",
      1
    );
    template.resourceCountIs("AWS::EC2::TransitGatewayRouteTable", 1);

    // We expect SSM named exports within our construct are prepared with Transit Route Table, and Association.
    expect(workloadIsolated.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-vpc-workload/tgwId"
    );
    expect(workloadIsolated.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-vpc-workload/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-vpc-workload/vpcId`,
      `${prefix}/vpcs/test-vpc-workload/vpcCidr`,
      `${prefix}/vpcs/test-vpc-workload/az0`,
      `${prefix}/vpcs/test-vpc-workload/az1`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-vpc-workload/subnets/testing/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-vpc-workload/tgwAttachId`,
      `${prefix}/vpcs/test-vpc-workload/tgwRouteId`,
      `${prefix}/vpcs/test-vpc-workload/tgwId`,
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: parameterName,
      });
    }
  }
});

test("WorkloadIsolatedBaseWithSharedSubnets", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const workloadIsolated = newVpcWorkloadStack(
      {
        globalPrefix: "globalPrefix",
        ssmParameterPrefix: "/ssm/prefix",
        namePrefix: "Test",
        vpcCidr: "10.1.0.0/16",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        withTgw: true,
        organizationId: "o-12345",
        organizationMainAccountId: "012345678910",
        createSubnets: [
          {
            name: "testing",
            cidrMask: 21,
            sharedWith: [12345678910, "o-12345", "ou-12345"],
          },
        ],
      },
      app,
      "workloadIsolated",
      ITgwedId
    );
    workloadIsolated.saveTgwRouteInformation();
    workloadIsolated.attachToTGW();
    workloadIsolated.createSsmParameters();
    const template = Template.fromStack(workloadIsolated);

    // We expect RAM share stanzas for our subnets.  One account, one OU, and one full Org
    template.hasResourceProperties("AWS::RAM::ResourceShare", {
      Principals: Match.arrayWith(["12345678910"]),
    });
    template.hasResourceProperties("AWS::RAM::ResourceShare", {
      Principals: Match.arrayWith([
        "arn:aws:organizations::012345678910/o-12345",
      ]),
    });
    template.hasResourceProperties("AWS::RAM::ResourceShare", {
      Principals: Match.arrayWith([
        "arn:aws:organizations::012345678910:ou/o-12345/ou-12345",
      ]),
    });
  }
});
