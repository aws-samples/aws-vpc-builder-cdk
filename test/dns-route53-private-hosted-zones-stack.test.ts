import { Template, Match } from "aws-cdk-lib/assertions";

import { DnsRoute53PrivateHostedZonesClass } from "../lib/dns-route53-private-hosted-zones-stack";
import * as cdk from "aws-cdk-lib";
import { IVpcWorkloadProps } from "../lib/types";
import { VpcWorkloadIsolatedStack } from "../lib/vpc-workload-isolated-stack";
import { TransitGatewayStack } from "../lib/transit-gateway-stack";

const newTransitGateway = (app: cdk.App) => {
  return new TransitGatewayStack(app, "TransitGatewayStack", {
    tgwDescription: "Test Transit Gateway",
    namePrefix: "Testing",
  });
};

const newVpcWorkloadIsolatedStack = (
  props: Partial<IVpcWorkloadProps>,
  app: cdk.App
) => {
  const transitGatewayStack = newTransitGateway(app);
  const commonProps: IVpcWorkloadProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.1.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    withTgw: true,
    tgw: transitGatewayStack.tgw,
    createSubnets: [
      {
        name: "testing",
        cidrMask: 21,
      },
    ],
    ...props,
  };

  return new VpcWorkloadIsolatedStack(
    app,
    "VpcWorkloadIsolatedStack",
    commonProps
  );
};

test("DnsPrivateHostedZonesBase", () => {
  const app = new cdk.App();
  const dnsStack = new DnsRoute53PrivateHostedZonesClass(app, "DnsStack", {
    namePrefix: "testing",
    dnsEntries: {
      domains: ["amclean.org"],
    },
  });

  const template = Template.fromStack(dnsStack);
  // Hosted zone for amclean.org with no VPCs attached
  template.hasResourceProperties("AWS::Route53::HostedZone", {
    Name: "amclean.org",
    VPCs: [],
  });
});

test("DnsPrivateHostedZonesImportVpcs", () => {
  const app = new cdk.App();
  const dnsStack = new DnsRoute53PrivateHostedZonesClass(app, "DnsStack", {
    namePrefix: "testing",
    dnsEntries: {
      domains: ["amclean.org"],
      shareWithExistingVpcs: [
        {
          vpcId: "vpc-1234",
          vpcRegion: "us-east-2",
        },
      ],
    },
  });

  const template = Template.fromStack(dnsStack);
  // VPCs now with ID and Region
  template.hasResourceProperties("AWS::Route53::HostedZone", {
    Name: "amclean.org",
    VPCs: [
      {
        VPCId: "vpc-1234",
        VPCRegion: "us-east-2",
      },
    ],
  });
});

test("DnsPrivateHostedZonesSameStackVpcs", () => {
  const app = new cdk.App();
  const workloadStack = newVpcWorkloadIsolatedStack({}, app);
  workloadStack.saveTgwRouteInformation();
  workloadStack.attachToTGW();
  workloadStack.createSsmParameters();

  const dnsStack = new DnsRoute53PrivateHostedZonesClass(app, "DnsStack", {
    namePrefix: "testing",
    dnsEntries: {
      domains: ["amclean.org"],
      shareWithVpcs: [workloadStack],
    },
  });

  const template = Template.fromStack(dnsStack);
  // VPC is an import reference to our dependant stack (so CDK can order appropriately)
  template.hasResourceProperties("AWS::Route53::HostedZone", {
    Name: "amclean.org",
    VPCs: [
      {
        VPCId: Match.objectLike({ "Fn::ImportValue": Match.anyValue() }),
        VPCRegion: Match.objectLike({ Ref: "AWS::Region" }),
      },
    ],
  });
});
