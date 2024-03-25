import {
  IVpcWorkloadProps,
  ITgw,
} from "../lib/types";
import { TransitGatewayStack } from "../lib/transit-gateway-stack";
import {
  IVpcInterfaceEndpointsProps,
  VpcInterfaceEndpointsStack,
} from "../lib/vpc-interface-endpoints-stack";
import {
  VpcRoute53ResolverEndpointsStack,
  IVpcRoute53ResolverEndpointsProps,
} from "../lib/vpc-route53-resolver-endpoints-stack";
import {
  IVpcNatEgressProps,
  VpcNatEgressStack,
} from "../lib/vpc-nat-egress-stack";
import {
  IVpcAwsNetworkFirewallProps,
  VpcAwsNetworkFirewallStack,
} from "../lib/vpc-aws-network-firewall-stack";
import { VpcWorkloadIsolatedStack } from "../lib/vpc-workload-isolated-stack";
import { VpcWorkloadPublicStack } from "../lib/vpc-workload-public-stack";
import {
  IVpnToTransitGatewayProps,
  VpnToTransitGatewayStack,
} from "../lib/vpn-to-transit-gateway-stack";
import {
  IDirectConnectGatewayProps,
  DirectConnectGatewayStack,
} from "../lib/direct-connect-gateway-stack";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as fs from "fs";
import * as path from "path";
import {ITransitGatewayPeerProps, TransitGatewayPeerStack} from "../lib/transit-gateway-peer-stack";

const interfaceDiscovery = JSON.parse(
  fs.readFileSync(path.join("discovery", `endpoints-us-east-1.json`), {
    encoding: "utf8",
  })
);

export const newTransitGateway = (app: cdk.App) => {
  return new TransitGatewayStack(app, "TransitGatewayStack", {
    tgwDescription: "Test Transit Gateway",
    namePrefix: "Testing",
  });
};

export const newVpcWorkloadStack = (
  props: Partial<IVpcWorkloadProps>,
  app: cdk.App,
  style: "workloadIsolated" | "workloadPublic",
  tgw?: ec2.CfnTransitGateway | ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }
  const commonProps: IVpcWorkloadProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.1.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    withTgw: true,
    tgw: transitGateway,
    createSubnets: [
      {
        name: "testing",
        cidrMask: 21,
      },
    ],
    ...props,
  };

  if (style == "workloadIsolated") {
    return new VpcWorkloadIsolatedStack(
      app,
      `${props.namePrefix}VpcWorkloadIsolatedStack`,
      commonProps
    );
  } else {
    return new VpcWorkloadPublicStack(
      app,
      `${props.namePrefix}VpcWorkloadPublicStack`,
      commonProps
    );
  }
};

export const newNatEgressStack = (
  props: Partial<IVpcNatEgressProps>,
  app: cdk.App,
  tgw?: ec2.CfnTransitGateway | ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }

  const commonProps: IVpcNatEgressProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.2.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    withTgw: true,
    tgw: transitGateway,
    ...props,
  };

  return new VpcNatEgressStack(
    app,
    `${props.namePrefix}VpcNatEgressStack`,
    commonProps
  );
};

export const newVpcInterfaceEndpointsStack = (
  props: Partial<IVpcInterfaceEndpointsProps>,
  app: cdk.App,
  interfaceList: Array<string>,
  tgw?: ec2.CfnTransitGateway | ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }
  const commonProps: IVpcInterfaceEndpointsProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.3.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    interfaceList: interfaceList,
    interfaceDiscovery: interfaceDiscovery,
    withTgw: true,
    tgw: transitGateway,
    ...props,
  };

  return new VpcInterfaceEndpointsStack(
    app,
    `${props.namePrefix}VpcInterfaceEndpointsStack`,
    commonProps
  );
};

export const newAwsNetworkFirewallStack = (
  props: Partial<IVpcAwsNetworkFirewallProps>,
  app: cdk.App,
  tgw?: ec2.CfnTransitGateway | ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }

  const commonProps: IVpcAwsNetworkFirewallProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.4.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    withTgw: true,
    tgw: transitGateway,
    firewallName: "FirewallName",
    firewallDescription: "Firewall Description",
    ...props,
  };

  return new VpcAwsNetworkFirewallStack(
    app,
    `${props.namePrefix}VpcAwsNetworkFirewallStack`,
    commonProps
  );
};

export const newVpnStack = (
  props: Partial<IVpnToTransitGatewayProps>,
  app: cdk.App,
  tgw?: ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }

  const commonProps: IVpnToTransitGatewayProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    withTgw: true,
    tgw: transitGateway,
    ...props,
  };

  return new VpnToTransitGatewayStack(
    app,
    `${props.namePrefix}VpnToTransitGatewayStack`,
    commonProps
  );
};

export const newDxGwStack = (
    props: Partial<IDirectConnectGatewayProps>,
    app: cdk.App,
) => {
  const commonProps: IDirectConnectGatewayProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    existingDxGwTransitGatewayAttachId: "tgw-attach-12345",
    existingDxGwTransitGatewayRouteTableId: "tgw-rtb-12345",
    existingTransitGatewayId: "tgw-12345",
    ...props,
  };

  return new DirectConnectGatewayStack(
      app,
      `${props.namePrefix}DirectConnectGatewayStack`,
      commonProps
  );
};

export const newTgwPeerStack = (
    props: Partial<ITransitGatewayPeerProps>,
    app: cdk.App,
) => {
  const commonProps: ITransitGatewayPeerProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    existingPeerTransitGatewayAttachId: "tgw-attach-678910",
    existingPeerTransitGatewayRouteTableId: "tgw-rtb-678910",
    existingTransitGatewayId: "tgw-678910",
    ...props,
  };

  return new TransitGatewayPeerStack(
      app,
      `${props.namePrefix}TransitGatewayPeerStack`,
      commonProps
  );
};

export const newVpcRoute53ResolverStack = (
  props: Partial<IVpcRoute53ResolverEndpointsProps>,
  app: cdk.App,
  tgw?: ec2.CfnTransitGateway | ITgw
) => {
  let transitGateway = tgw;
  if (!transitGateway) {
    const transitGatewayStack = newTransitGateway(app);
    transitGateway = transitGatewayStack.tgw;
  }
  const commonProps: IVpcRoute53ResolverEndpointsProps = {
    globalPrefix: "globalPrefix",
    ssmParameterPrefix: "/ssm/prefix",
    namePrefix: "Test",
    vpcCidr: "10.5.0.0/16",
    availabilityZones: ["us-east-1a", "us-east-1b"],
    withTgw: true,
    tgw: transitGateway,
    ...props,
  };

  return new VpcRoute53ResolverEndpointsStack(
    app,
    `${props.namePrefix}VpcInterfaceEndpointsStack`,
    commonProps
  );
};
