import { Template, Match } from "aws-cdk-lib/assertions";
import { newVpcWorkloadStack } from "./stack-builder-helper";
import { ITgw } from "../lib/types";
import * as cdk from "aws-cdk-lib";

test("WorkloadPublicBase", () => {
  for (const transitStyle of ["stack", "imported"]) {
    const app = new cdk.App();
    let ITgwedId: ITgw | undefined = undefined;
    if (transitStyle == "imported") {
      ITgwedId = {
        attrId: "tgw-12392488",
      };
    }
    const workloadPublic = newVpcWorkloadStack(
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
      "workloadPublic",
      ITgwedId
    );
    workloadPublic.saveTgwRouteInformation();
    workloadPublic.attachToTGW();
    workloadPublic.createSsmParameters();
    const template = Template.fromStack(workloadPublic);
    // We've provided 2 AZs and left our transit gateway specific to default of false so expect to see 2 subnets.
    template.resourceCountIs("AWS::EC2::Subnet", 2);

    // Public subnets exist
    expect(workloadPublic.publicSubnetNames).toEqual(["testing"]);
    // Private subnet (NATed) do not exist
    expect(workloadPublic.privateSubnetNames).toEqual([]);
    // Private Subnets do not exist
    expect(workloadPublic.privateIsolatedSubnetNames).toEqual([]);

    // We expect NAT does not exist, but IGW does
    expect(() => template.hasResource("AWS::EC2::NatGateway", {})).toThrow();
    expect(() =>
      template.hasResource("AWS::EC2::InternetGateway", {})
    );

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
    expect(workloadPublic.tgwAttachmentSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-vpc-public-workload/tgwId"
    );
    expect(workloadPublic.tgwRouteTableSsm.name).toEqual(
      "/ssm/prefix/networking/globalprefix/vpcs/test-vpc-public-workload/tgwRouteId"
    );

    const prefix = "/ssm/prefix/networking/globalprefix";
    for (const parameterName of [
      `${prefix}/vpcs/test-vpc-public-workload/vpcId`,
      `${prefix}/vpcs/test-vpc-public-workload/vpcCidr`,
      `${prefix}/vpcs/test-vpc-public-workload/az0`,
      `${prefix}/vpcs/test-vpc-public-workload/az1`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1a/routeTableId`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1a/subnetCidr`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1a/subnetId`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1b/routeTableId`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1b/subnetCidr`,
      `${prefix}/vpcs/test-vpc-public-workload/subnets/testing/us-east-1b/subnetId`,
      `${prefix}/vpcs/test-vpc-public-workload/tgwAttachId`,
      `${prefix}/vpcs/test-vpc-public-workload/tgwRouteId`,
      `${prefix}/vpcs/test-vpc-public-workload/tgwId`,
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
    const workloadPublic = newVpcWorkloadStack(
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
      "workloadPublic",
      ITgwedId
    );
    workloadPublic.saveTgwRouteInformation();
    workloadPublic.attachToTGW();
    workloadPublic.createSsmParameters();
    const template = Template.fromStack(workloadPublic);

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
    // The name should match 'Share-${vpcName}'
    template.hasResourceProperties("AWS::RAM::ResourceShare", {
      Name: "Share-test-vpc-public-workload",
    });
  }
});
