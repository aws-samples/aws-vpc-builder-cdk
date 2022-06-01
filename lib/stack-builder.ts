#!/usr/bin/env node
import "source-map-support/register";
import { ServiceDetail } from "@aws-sdk/client-ec2";
import {
  IBuilderVpc,
  IVpcWorkloadProps,
  SubnetNamedMasks,
  ITgwPropagateRouteAttachmentName,
  IBuilderVpn,
  ITransitGatewayBase,
  ITgw,
} from "./types";
import { ConfigParser } from "./config/parser";
import {
  IConfig,
  IConfigTgwRoutes,
  IConfigProviderEndpoints,
} from "./config/config-types";
import { StackMapper } from "./stack-mapper";
import { TransitGatewayStack } from "./transit-gateway-stack";
import { IVpcRoute53ResolverEndpointsProps } from "./vpc-route53-resolver-endpoints-stack";
import { IVpcInterfaceEndpointsProps } from "./vpc-interface-endpoints-stack";
import * as path from "path";
import * as fs from "fs";

export interface namedVpcStack {
  name: string;
  stack: IBuilderVpc;
}

export interface namedTgwStack {
  name: string;
  stack: TransitGatewayStack;
}

export interface namedVpnStack {
  name: string;
  stack: IBuilderVpn;
}

export type cdkVpcStackTypes =
  | "providerEndpoint"
  | "providerInternet"
  | "providerFirewall"
  | "workload";

export interface cdkStacks {
  transitGateway: Array<namedTgwStack>;
  vpn: Array<namedVpnStack>;
  providerEndpoint: Array<namedVpcStack>;
  providerInternet: Array<namedVpcStack>;
  providerFirewall: Array<namedVpcStack>;
  workload: Array<namedVpcStack>;
}

export type providerKeys =
  | "providerEndpoint"
  | "providerInternet"
  | "providerFirewall";
export type vpnKeys = "vpn";
export type workloadKeys = "workload";
export type transitGatewayKeys = "transitGateway";

export interface IStackBuilderProps {}

export class StackBuilderClass {
  configFilename: string;
  configContents: string;
  stackMapper: StackMapper;
  stacks: cdkStacks = {
    transitGateway: [],
    vpn: [],
    providerEndpoint: [],
    providerInternet: [],
    providerFirewall: [],
    workload: [],
  };
  configParser: ConfigParser;
  c: IConfig;
  interfaceDiscovery: Array<ServiceDetail> = [];
  interfaceList: Array<string> = [];

  constructor(props?: IStackBuilderProps) {
    this.stackMapper = new StackMapper();
  }

  configure(configFilename?: string, configContents?: string) {
    this.configParser = new ConfigParser({
      configFilename: configFilename,
      configContents: configContents,
    });
    try {
      this.configParser.parse();
      this.c = this.configParser.config;
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(e.message);
      }
    }
    this.stackMapper.configure(this.c);
  }

  async build() {
    // Start with our transit gateway stack since it may relate to workload
    if (this.c.transitGateways) {
      await this.buildTransitGatewayStacks();
    }

    // Build our workload vpcs first since they can relate to the TGW
    await this.buildWorkloadStacks();

    // Build our VPN if configured
    if (this.c.vpns) {
      await this.buildVpnStacks();
    }

    // Build all of our provider stacks if they are configured
    if (this.c.providers?.endpoints) {
      for (let endpointName of Object.keys(this.c.providers?.endpoints)) {
        const configStanza = this.c.providers.endpoints[endpointName];
        if (configStanza.style == "serviceInterfaceEndpoint") {
          // Endpoints need a discovery to know all endpoints that exist in our AZs and region for vpc endpoint types
          this.readEndpointDiscovery();
          // We also need a secondary config file with the list of endpoints we want setup
          this.readEndpointList(configStanza);
        }
      }
      await this.buildEndpointStacks();
    }

    if (this.c.providers?.internet) {
      await this.buildInternetStacks();
    }

    if (this.c.providers?.firewall) {
      await this.buildFirewallStacks();
    }

    // If we have private hosted zones create/associate them with our Vpcs
    if (this.c.dns) {
      for (const dnsStanzaName of Object.keys(this.c.dns)) {
        // the 'shareWithVpcs' is a 'within our local config' reference, so find those VPCs
        // So we can pass them to our DNS Stack constructor.
        const dnsStanza = this.c.dns[dnsStanzaName];
        const sharedWithAppStacks: Array<IBuilderVpc> = [];
        if (dnsStanza.shareWithVpcs) {
          dnsStanza.shareWithVpcs.forEach((shareWithVpc) => {
            sharedWithAppStacks.push(this.builderVpcStackByName(shareWithVpc));
          });
        }
        this.stackMapper.dnsPrivateHostedZoneStack(
          `${dnsStanzaName}-dns-private-hosted-zones`,
          {
            namePrefix: dnsStanzaName,
            dnsEntries: {
              domains: dnsStanza.domains,
              shareWithVpcs: sharedWithAppStacks,
              shareWithExistingVpcs: dnsStanza.shareWithExistingVpcs,
            },
          }
        );
      }
    }

    // Now our stacks are in place, associate our route relationships between them
    if (this.c.transitGateways) {
      this.associateTgwRoutes();
      const allNamedStacks = this.allNamedVpcStacks();
      this.stackMapper.transitGatewayRoutesStack("transit-gateway-routes", {
        tgwAttachmentsAndRoutes: allNamedStacks,
      });
      // Use our Dummy Stack to assure our key exports (tgw ID, vpc ID, TGW attach ID remain exported)
      // Really only required when we're attaching to a TGW.  Stand alone VPCs don't require exports to
      // co-ordinate their installation.
      this.stackMapper.cdkExportPersistStack("cdk-export-persistence", {
        persistExports: allNamedStacks,
      });
    }
  }

  async buildWorkloadStacks() {
    for (const workloadVpcName of Object.keys(this.c.vpcs)) {
      const configStanza = this.c.vpcs[workloadVpcName];

      const subnets: Array<SubnetNamedMasks> = [];
      for (const subnetName of Object.keys(configStanza.subnets)) {
        subnets.push({
          name: subnetName,
          cidrMask: configStanza.subnets[subnetName].cidrMask,
          sharedWith: configStanza.subnets[subnetName].sharedWith,
        });
      }

      const stackProps: IVpcWorkloadProps = {
        globalPrefix: this.c.global.stackNamePrefix,
        organizationId: this.c.global.organizationId,
        namePrefix: workloadVpcName,
        availabilityZones: configStanza.availabilityZones
          ? configStanza.availabilityZones
          : this.c.global.availabilityZones,
        ssmParameterPrefix: this.c.global.ssmPrefix,
        vpcCidr: configStanza.vpcCidr,
        createSubnets: subnets,
      };

      const transitGatewayName = this.workloadHasTransit(workloadVpcName);
      if (transitGatewayName) {
        stackProps.withTgw = true;
        stackProps.tgw = this.transitGatewayStackByName(
          "transitGateway",
          transitGatewayName
        ).tgw;
      } else {
        stackProps.withTgw = false;
      }

      this.stacks.workload.push({
        name: workloadVpcName,
        stack: await this.stackMapper.workloadStacks(
          configStanza.style,
          `${workloadVpcName}-vpc-workload`,
          stackProps
        ),
      });
    }
  }

  readEndpointDiscovery() {
    const discoveryFolder = this.c.global.discoveryFolder
      ? this.c.global.discoveryFolder
      : "discovery";
    this.interfaceDiscovery = JSON.parse(
      fs.readFileSync(
        path.join(discoveryFolder, `endpoints-${this.c.global.region}.json`),
        { encoding: "utf8" }
      )
    );
  }

  readEndpointList(configStanza: IConfigProviderEndpoints) {
    const endpointFilePrefix = configStanza.endpointConfigFile
      ? configStanza.endpointConfigFile
      : "endpointlist";
    this.interfaceList = fs
      .readFileSync(
        path.join(
          "config",
          `${endpointFilePrefix}-${this.c.global.region}.txt`
        ),
        { encoding: "utf8" }
      )
      .split("\n");
  }

  async buildTransitGatewayStacks() {
    for (const transitGatewayName of Object.keys(this.c.transitGateways!)) {
      const configStanza = this.c.transitGateways![transitGatewayName];
      if (configStanza.useExistingTgwId) {
        const tgwImportedId: ITgw = {
          attrId: configStanza.useExistingTgwId,
        };
        const importedTgw: ITransitGatewayBase = {
          name: transitGatewayName,
          tgwStyle: "transitGateway",
          provides: "transitGateway",
          tgw: tgwImportedId,
          props: {
            namePrefix: transitGatewayName,
            tgwDescription: "imported",
          },
        };
        this.stacks.transitGateway.push({
          name: transitGatewayName,
          stack: importedTgw as TransitGatewayStack,
        });
      } else {
        this.stacks.transitGateway.push({
          name: transitGatewayName,
          stack: await this.stackMapper.transitGatewayStacks(
            configStanza.style,
            `${transitGatewayName}-transit-gateway`,
            {
              namePrefix: transitGatewayName,
              tgwDescription: configStanza.tgwDescription,
            }
          ),
        });
      }
    }
  }

  async buildVpnStacks() {
    for (const vpnName of Object.keys(this.c.vpns!)) {
      const configStanza = this.c.vpns![vpnName];
      this.stacks.vpn.push({
        name: vpnName,
        stack: await this.stackMapper.vpnStacks(
          configStanza.style,
          `${vpnName}-vpn`,
          {
            namePrefix: vpnName,
            globalPrefix: this.c.global.stackNamePrefix,
            ssmParameterPrefix: this.c.global.ssmPrefix,
            existingCustomerGatewayId:
              this.c.vpns![vpnName].existingCustomerGatewayId,
            tunnelOneOptions: this.c.vpns![vpnName].tunnelOneOptions,
            tunnelTwoOptions: this.c.vpns![vpnName].tunnelTwoOptions,
            newCustomerGatewayAsn: this.c.vpns![vpnName].newCustomerGatewayAsn,
            newCustomerGatewayIpAddress:
              this.c.vpns![vpnName].newCustomerGatewayIp,
            newCustomerGatewayName:
              this.c.vpns![vpnName].newCustomerGatewayName,
            existingVpnConnectionId:
              this.c.vpns![vpnName].existingVpnConnectionId,
            existingVpnTransitGatewayAttachId:
              this.c.vpns![vpnName].existingVpnTransitGatewayAttachId,
            existingVpnTransitGatewayRouteTableId:
              this.c.vpns![vpnName].existingVpnTransitGatewayRouteTableId,
            withTgw: true,
            tgw: this.transitGatewayStackByName(
              "transitGateway",
              configStanza.useTransit
            ).tgw,
          }
        ),
      });
    }
  }

  async buildEndpointStacks() {
    for (const endpointName of Object.keys(this.c.providers?.endpoints!)) {
      const configStanza = this.c.providers!.endpoints![endpointName];
      if (configStanza.style == "serviceInterfaceEndpoint") {
        await this.createEndpointServiceInterfaceStack(
          endpointName,
          configStanza
        );
      }
      if (configStanza.style == "route53ResolverEndpoint") {
        await this.createEndpointRoute53ResolverStack(
          endpointName,
          configStanza
        );
      }
    }
  }

  async createEndpointServiceInterfaceStack(
    endpointName: string,
    configStanza: IConfigProviderEndpoints
  ) {
    const interfaceEndpointSharedWithVpcs: Array<ITgwPropagateRouteAttachmentName> =
      [];
    // Figure out which Endpoints we're sharing with (configures the Route53 VPC Share)
    this.allWorkloadForEndpoint(endpointName).forEach((workloadName) => {
      const workloadStack = this.stacks.workload.filter(
        (stack) => stack.name == workloadName
      );
      interfaceEndpointSharedWithVpcs.push({
        attachTo: workloadStack[0].stack,
      });
    });
    this.stacks.providerEndpoint.push({
      name: endpointName,
      stack: await this.stackMapper.providerEndpointStacks(
        configStanza.style,
        `${endpointName}-provider-endpoints-service-interface`,
        {
          namePrefix: endpointName,
          availabilityZones: configStanza.availabilityZones
            ? configStanza.availabilityZones
            : this.c.global.availabilityZones,
          ssmParameterPrefix: this.c.global.ssmPrefix,
          globalPrefix: this.c.global.stackNamePrefix,
          vpcCidr: configStanza.vpcCidr,
          perSubnetCidrMask: configStanza.endpointMask,
          interfaceDiscovery: this.interfaceDiscovery,
          interfaceList: this.interfaceList,
          tgwPropagateRouteAttachmentNames: interfaceEndpointSharedWithVpcs,
          interfaceEndpointSharedWithVpcs: interfaceEndpointSharedWithVpcs,
          withTgw: true,
          tgw: this.transitGatewayStackByName(
            "transitGateway",
            configStanza.useTransit
          ).tgw,
        } as IVpcInterfaceEndpointsProps
      ),
    });
  }

  async createEndpointRoute53ResolverStack(
    endpointName: string,
    configStanza: IConfigProviderEndpoints
  ) {
    // If we're sharing with VPCs in our configuration stanza they are within this configuration.  Map them to get their VPC IDs.
    const sharedWithAppStacks: Array<IBuilderVpc> = [];
    if (configStanza.forwardRequests?.forVpcs) {
      configStanza.forwardRequests?.forVpcs.forEach((vpcName) => {
        sharedWithAppStacks.push(this.builderVpcStackByName(vpcName));
      });
    }
    this.stacks.providerEndpoint.push({
      name: endpointName,
      stack: await this.stackMapper.providerEndpointStacks(
        configStanza.style,
        `${endpointName}-provider-endpoints-route53-resolver`,
        {
          namePrefix: endpointName,
          availabilityZones: configStanza.availabilityZones
            ? configStanza.availabilityZones
            : this.c.global.availabilityZones,
          ssmParameterPrefix: this.c.global.ssmPrefix,
          globalPrefix: this.c.global.stackNamePrefix,
          vpcCidr: configStanza.vpcCidr,
          forwardRequests: {
            toIps: configStanza.forwardRequests?.toIps,
            forDomains: configStanza.forwardRequests?.forDomains,
            forVpcs: sharedWithAppStacks,
            forExistingVpcs: configStanza.forwardRequests?.forExistingVpcs,
          },
          resolveRequestsFromCidrs: configStanza.resolveRequestsFromCidrs,
          withTgw: true,
          tgw: this.transitGatewayStackByName(
            "transitGateway",
            configStanza.useTransit
          ).tgw,
        } as IVpcRoute53ResolverEndpointsProps
      ),
    });
  }

  async buildFirewallStacks() {
    for (const firewallName of Object.keys(this.c?.providers!.firewall!)) {
      const configStanza = this.c?.providers!.firewall![firewallName];
      this.stacks.providerFirewall.push({
        name: firewallName,
        stack: await this.stackMapper.providerFirewallStacks(
          configStanza.style,
          `${firewallName}-provider-firewall`,
          {
            namePrefix: firewallName,
            availabilityZones: configStanza.availabilityZones
              ? configStanza.availabilityZones
              : this.c.global.availabilityZones,
            ssmParameterPrefix: this.c.global.ssmPrefix,
            globalPrefix: this.c.global.stackNamePrefix,
            vpcCidr: configStanza.vpcCidr,
            firewallDescription: configStanza.firewallDescription,
            firewallName: configStanza.firewallName,
            firewallPolicyArn: configStanza.awsFirewallExistingRuleArn,
            withTgw: true,
            tgw: this.transitGatewayStackByName(
              "transitGateway",
              configStanza.useTransit
            ).tgw,
          }
        ),
      });
    }
  }

  async buildInternetStacks() {
    for (const internetName of Object.keys(this.c?.providers!.internet!)) {
      const configStanza = this.c?.providers!.internet![internetName];
      // Find the TGW this endpoint provider will use
      this.stacks.providerInternet.push({
        name: internetName,
        stack: await this.stackMapper.providerInternetStacks(
          configStanza.style,
          `${internetName}-provider-internet`,
          {
            namePrefix: internetName,
            availabilityZones: configStanza.availabilityZones
              ? configStanza.availabilityZones
              : this.c.global.availabilityZones,
            ssmParameterPrefix: this.c.global.ssmPrefix,
            globalPrefix: this.c.global.stackNamePrefix,
            vpcCidr: configStanza.vpcCidr,
            withTgw: true,
            tgw: this.transitGatewayStackByName(
              "transitGateway",
              configStanza.useTransit
            ).tgw,
          }
        ),
      });
    }
  }

  associateTgwRoutes() {
    for (let transitGatewayName of Object.keys(this.c.transitGateways!)) {
      const configStanza = this.c?.transitGateways![transitGatewayName];
      this.associateDynamicTgwRoutes(configStanza);
      this.associateDefaultTgwRoutes(configStanza);
      this.associateStaticTgwRoutes(configStanza);
      this.associateBlackholeTgwRoutes(configStanza);
    }
  }

  associateDynamicTgwRoutes(configStanza: IConfigTgwRoutes) {
    configStanza.dynamicRoutes?.forEach((route) => {
      const vpcStack = this.routableStackByName(route.vpcName);
      const attachStack = this.routableStackByName(route.routesTo);
      let inspectedByStack: IBuilderVpc | undefined;
      if (route.inspectedBy) {
        inspectedByStack = this.providerStackByName(
          "providerFirewall",
          route.inspectedBy
        );
      }
      vpcStack.tgwPropagateRouteAttachmentNames.push({
        attachTo: attachStack,
        inspectBy: inspectedByStack,
      });
    });
  }

  associateDefaultTgwRoutes(configStanza: IConfigTgwRoutes) {
    configStanza.defaultRoutes?.forEach((route) => {
      const vpcStack = this.routableStackByName(route.vpcName);
      const attachStack = this.routableStackByName(route.routesTo);
      let inspectedByStack: IBuilderVpc | undefined;
      if (route.inspectedBy) {
        inspectedByStack = this.providerStackByName(
          "providerFirewall",
          route.inspectedBy
        );
      }
      vpcStack.tgwDefaultRouteAttachmentName = {
        attachTo: attachStack,
        inspectBy: inspectedByStack,
      };
    });
  }

  associateStaticTgwRoutes(configStanza: IConfigTgwRoutes) {
    configStanza.staticRoutes?.forEach((route) => {
      const vpcStack = this.routableStackByName(route.vpcName);
      const attachStack = this.routableStackByName(route.routesTo);
      let inspectedByStack: IBuilderVpc | undefined;
      if (route.inspectedBy) {
        inspectedByStack = this.providerStackByName(
          "providerFirewall",
          route.inspectedBy
        );
      }
      vpcStack.tgwStaticRoutes.push({
        cidrAddress: route.staticCidr,
        attachTo: attachStack,
        inspectBy: inspectedByStack,
      });
    });
  }

  associateBlackholeTgwRoutes(configStanza: IConfigTgwRoutes) {
    configStanza.blackholeRoutes?.forEach((route) => {
      const vpcStack = this.workloadStackByName("workload", route.vpcName);
      vpcStack.tgwBlackHoleCidrs.push(...route.blackholeCidrs);
    });
  }

  // Association with a route table or configuration of a provider means we must transit gateway connect
  workloadHasTransit(workloadName: string): string {
    // First pass we will look at associations in the route tables.  We'll return our first match
    for (const transitGatewayName of Object.keys(this.c.transitGateways!)) {
      const configStanza = this.c?.transitGateways![transitGatewayName];
      if (
        configStanza.staticRoutes?.find(
          (routes) => routes.vpcName == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.staticRoutes?.find(
          (routes) => routes.routesTo == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.dynamicRoutes?.find(
          (routes) => routes.vpcName == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.dynamicRoutes?.find(
          (routes) => routes.routesTo == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.blackholeRoutes?.find(
          (routes) => routes.vpcName == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.defaultRoutes?.find(
          (routes) => routes.vpcName == workloadName
        )
      ) {
        return transitGatewayName;
      }
      if (
        configStanza.defaultRoutes?.find(
          (routes) => routes.routesTo == workloadName
        )
      ) {
        return transitGatewayName;
      }
    }
    // Second pass we will look for the use of a provider.  Return our providers TransitGateway
    if (this.c.vpcs[workloadName].providerEndpoints) {
      const endpointName = this.c.vpcs[workloadName]
        .providerEndpoints as string;
      return this.c.providers?.endpoints![endpointName].useTransit as string;
    }
    if (this.c.vpcs[workloadName].providerInternet) {
      const internetName = this.c.vpcs[workloadName].providerInternet as string;
      return this.c.providers?.internet![internetName].useTransit as string;
    }
    return "";
  }

  allNamedVpcStacks(): Array<IBuilderVpc | IBuilderVpn> {
    const allStacks: Array<IBuilderVpc | IBuilderVpn> = [];
    const cdkStackTypes: Array<cdkVpcStackTypes> = [
      "providerEndpoint",
      "providerInternet",
      "providerFirewall",
      "workload",
    ];
    for (const cdkStackType of cdkStackTypes) {
      this.stacks[cdkStackType].forEach((namedStack) => {
        allStacks.push(namedStack.stack);
      });
    }
    this.stacks.vpn.forEach((namedStack) => {
      allStacks.push(namedStack.stack);
    });
    return allStacks;
  }

  routableStackByName(stackName: string): IBuilderVpc | IBuilderVpn {
    // Try for a workload stack first, this is the most common
    try {
      return this.workloadStackByName("workload", stackName);
    } catch {}
    // Now try a provider stack
    const providerStyles: Array<providerKeys> = [
      "providerEndpoint",
      "providerInternet",
      "providerFirewall",
    ];
    for (const providerStyle of providerStyles) {
      try {
        return this.providerStackByName(providerStyle, stackName);
      } catch {}
    }
    // Now try a VPN stack
    try {
      return this.vpnStackByName("vpn", stackName);
    } catch {}
    throw new Error(
      `Unable find a workload, or provider VPC with name ${stackName}`
    );
  }

  builderVpcStackByName(stackName: string): IBuilderVpc {
    // Try for a workload stack first, this is the most common
    try {
      return this.workloadStackByName("workload", stackName);
    } catch {}
    // Now try a provider stack
    const providerStyles: Array<providerKeys> = [
      "providerEndpoint",
      "providerInternet",
      "providerFirewall",
    ];
    for (const providerStyle of providerStyles) {
      try {
        return this.providerStackByName(providerStyle, stackName);
      } catch {}
    }
    throw new Error(
      `Unable find a workload, or provider VPC with name ${stackName}`
    );
  }

  workloadStackByName(
    stackKey: workloadKeys,
    workloadName: string
  ): IBuilderVpc {
    const workloadNamed = this.stacks[stackKey].filter(
      (workloadNamed) => workloadNamed.name == workloadName
    )[0];
    if (workloadNamed) {
      return workloadNamed.stack;
    } else {
      throw new Error(
        `Unable to find Workload stack with name ${workloadName}`
      );
    }
  }

  providerStackByName(
    provider: providerKeys,
    providerName: string
  ): IBuilderVpc {
    const providerNamedStack = this.stacks[provider].filter(
      (providerStack) => providerStack.name == providerName
    )[0];
    if (providerNamedStack) {
      return providerNamedStack.stack;
    } else {
      throw new Error(
        `Unable to find provider type ${provider} name ${providerName}`
      );
    }
  }

  vpnStackByName(vpnKey: vpnKeys, vpnName: string): IBuilderVpn {
    const vpnNamedStack = this.stacks[vpnKey].filter(
      (vpnStack) => vpnStack.name == vpnName
    )[0];
    if (vpnNamedStack) {
      return vpnNamedStack.stack;
    } else {
      throw new Error(
        `Unable to find provider type ${vpnKey} name ${vpnNamedStack}`
      );
    }
  }

  transitGatewayStackByName(
    stackKey: transitGatewayKeys,
    transitGatewayName: string
  ): TransitGatewayStack {
    const transitGatewayConnect = this.stacks[stackKey].filter(
      (transitGateway) => transitGateway.name == transitGatewayName
    )[0];
    if (transitGatewayConnect) {
      return transitGatewayConnect.stack;
    } else {
      throw new Error(
        `Unable to find Transit Gateway stack with name ${transitGatewayName}`
      );
    }
  }

  allWorkloadForEndpoint(endpointName: string): Array<string> {
    const endpointUsedByVpcs: Array<string> = [];
    for (const workloadName of Object.keys(this.c.vpcs)) {
      if (this.c.vpcs[workloadName].providerEndpoints! == endpointName) {
        endpointUsedByVpcs.push(workloadName);
      }
    }
    return endpointUsedByVpcs;
  }
}
