import {
  IBuilderVpcStyle,
  ITransitGatewayStyle,
  IBuilderVpnStyle,
  IVpcWorkloadProps,
} from "./types";
import { IConfig } from "./config/config-types";
import {
  ITransitGatewayProps,
  TransitGatewayStack,
} from "./transit-gateway-stack";
import {
  IVpcInterfaceEndpointsProps,
  VpcInterfaceEndpointsStack,
} from "./vpc-interface-endpoints-stack";
import {
  VpcRoute53ResolverEndpointsStack,
  IVpcRoute53ResolverEndpointsProps,
} from "./vpc-route53-resolver-endpoints-stack";
import { IVpcNatEgressProps, VpcNatEgressStack } from "./vpc-nat-egress-stack";
import {
  IVpcAwsNetworkFirewallProps,
  VpcAwsNetworkFirewallStack,
} from "./vpc-aws-network-firewall-stack";
import { VpcWorkloadIsolatedStack } from "./vpc-workload-isolated-stack";
import { VpcWorkloadPublicStack } from "./vpc-workload-public-stack";
import {
  ITransitGatewayRoutesProps,
  TransitGatewayRoutesStack,
} from "./transit-gateway-routes-stack";
import {
  ICdkExportPersistenceProps,
  CdkExportPersistenceStack,
} from "./cdk-export-presistence-stack";
import {
  IVpnToTransitGatewayProps,
  VpnToTransitGatewayStack,
} from "./vpn-to-transit-gateway-stack";
import {
  IDnsRoute53PrivateHostedZonesProps,
  DnsRoute53PrivateHostedZonesClass,
} from "./dns-route53-private-hosted-zones-stack";
import * as cdk from "aws-cdk-lib";

export type workloadStackProps = IVpcWorkloadProps;
export type firewallStackProps = IVpcAwsNetworkFirewallProps;
export type endpointStackProps =
  | IVpcInterfaceEndpointsProps
  | IVpcRoute53ResolverEndpointsProps;
export type internetStackProps = IVpcNatEgressProps;
export type transitGatewayStackProps = ITransitGatewayProps;

export interface StackMapperProps {}

export class StackMapper {
  app: cdk.App = new cdk.App();
  c: IConfig;
  constructor(props?: StackMapperProps) {}

  configure(c: IConfig) {
    this.c = c;
  }

  async workloadStacks(
    style: IBuilderVpcStyle,
    stackName: string,
    props: workloadStackProps
  ) {
    if (style == "workloadIsolated" || style == "workloadPublic") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      let stackClass;
      if (style == "workloadPublic") {
        stackClass = new VpcWorkloadPublicStack(this.app, cfnStackName, props);
      } else {
        stackClass = new VpcWorkloadIsolatedStack(
          this.app,
          cfnStackName,
          props
        );
      }
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(`Workload - style ${style} is not implemented or mapped`);
    }
  }

  async vpnStacks(
    style: IBuilderVpnStyle,
    stackName: string,
    props: IVpnToTransitGatewayProps
  ) {
    if (style === "transitGatewayAttached") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new VpnToTransitGatewayStack(
        this.app,
        cfnStackName,
        props
      );
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(`Workload - style ${style} is not implemented or mapped`);
    }
  }

  async providerFirewallStacks(
    style: IBuilderVpcStyle,
    stackName: string,
    props: firewallStackProps
  ) {
    if (style == "awsNetworkFirewall") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new VpcAwsNetworkFirewallStack(
        this.app,
        cfnStackName,
        props
      );
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(
        `Provider: firewall - style ${style} is not implemented or mapped`
      );
    }
  }

  async providerEndpointStacks(
    style: IBuilderVpcStyle,
    stackName: string,
    props: endpointStackProps
  ) {
    if (style == "serviceInterfaceEndpoint") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new VpcInterfaceEndpointsStack(
        this.app,
        cfnStackName,
        <IVpcInterfaceEndpointsProps>props
      );
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else if (style == "route53ResolverEndpoint") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new VpcRoute53ResolverEndpointsStack(
        this.app,
        cfnStackName,
        <IVpcRoute53ResolverEndpointsProps>props
      );
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(
        `Provider: endpoint - style ${style} is not implemented or mapped`
      );
    }
  }

  async providerInternetStacks(
    style: IBuilderVpcStyle,
    stackName: string,
    props: internetStackProps
  ) {
    if (style == "natEgress") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new VpcNatEgressStack(this.app, cfnStackName, props);
      await stackClass.init();
      stackClass.saveTgwRouteInformation();
      stackClass.attachToTGW();
      stackClass.createSsmParameters();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(
        `Provider: internet - style ${style} is not implemented or mapped`
      );
    }
  }

  async transitGatewayStacks(
    style: ITransitGatewayStyle,
    stackName: string,
    props: transitGatewayStackProps
  ) {
    if (style == "transitGateway") {
      const cfnStackName =
        `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
      const stackClass = new TransitGatewayStack(this.app, cfnStackName, props);
      await stackClass.init();
      this.tagStack(stackClass);
      return stackClass;
    } else {
      throw new Error(
        `TransitGateway - style ${style} is not implemented or mapped`
      );
    }
  }

  dnsPrivateHostedZoneStack(
    stackName: string,
    props: IDnsRoute53PrivateHostedZonesProps
  ) {
    const cfnStackName =
      `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
    const stackClass = new DnsRoute53PrivateHostedZonesClass(
      this.app,
      cfnStackName,
      props
    );
    this.tagStack(stackClass);
    return stackClass;
  }

  transitGatewayRoutesStack(
    stackName: string,
    props: ITransitGatewayRoutesProps
  ) {
    const cfnStackName =
      `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
    const stackClass = new TransitGatewayRoutesStack(
      this.app,
      cfnStackName,
      props
    );
    this.tagStack(stackClass);
    return stackClass;
  }

  cdkExportPersistStack(stackName: string, props: ICdkExportPersistenceProps) {
    const cfnStackName =
      `${this.c.global.stackNamePrefix}-${stackName}`.toLowerCase();
    const stackClass = new CdkExportPersistenceStack(
      this.app,
      cfnStackName,
      props
    );
    this.tagStack(stackClass);
    return stackClass;
  }

  tagStack(stack: cdk.Stack) {
    this.c.global.tags?.forEach((tag) => {
      const key = Object.keys(tag)[0];
      cdk.Tags.of(stack).add(key, tag[key]);
    });
  }
}
