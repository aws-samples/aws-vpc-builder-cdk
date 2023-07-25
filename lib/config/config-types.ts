/*
 ****** global:
 */

export interface IConfigConfigTag {
  [key: string]: string;
}

export interface IConfigGlobal {
  stackNamePrefix: string;
  organizationId?: string;
  tags?: Array<IConfigConfigTag>;
  ssmPrefix: string;
  region: string;
  availabilityZones: Array<string>;
  discoveryFolder?: string;
  useLegacyIdentifiers?: boolean;
}

/*
 ****** providers:
 */

export type IConfigProvidersEndpointsStyles =
  | "serviceInterfaceEndpoint"
  | "route53ResolverEndpoint";
export type IConfigProvidersFirewallStyles = "awsNetworkFirewall";
export type IConfigProvidersInternetStyles = "natEgress";

export interface IConfigProviderRoute53EndpointsForExistingVpcs {
  name: string;
  vpcId: string;
}

export interface IConfigProviderRoute53EndpointsForwardRequests {
  forDomains: Array<string>;
  toIps: Array<string>;
  forVpcs?: Array<string>;
  forExistingVpcs?: Array<IConfigProviderRoute53EndpointsForExistingVpcs>;
}

export interface IConfigProviderEndpoints {
  vpcCidr: string;
  availabilityZones?: Array<string>;
  style: IConfigProvidersEndpointsStyles;
  useTransit: string;
  endpointMask?: number;
  endpointConfigFile?: string;
  forwardRequests?: IConfigProviderRoute53EndpointsForwardRequests;
  resolveRequestsFromCidrs?: Array<string>;
}

export interface IConfigProviderFirewall {
  vpcCidr: string;
  availabilityZones?: Array<string>;
  firewallName: string;
  firewallDescription: string;
  style: IConfigProvidersFirewallStyles;
  useTransit: string;
  awsFirewallExistingRuleArn?: string;
}

export interface IConfigProviderInternet {
  vpcCidr: string;
  availabilityZones?: Array<string>;
  useTransit: string;
  style: IConfigProvidersInternetStyles;
}

export interface IConfigProviderEndpointsNamed {
  [key: string]: IConfigProviderEndpoints;
}

export interface IConfigProviderFirewallNamed {
  [key: string]: IConfigProviderFirewall;
}

export interface IConfigProviderInternetNamed {
  [key: string]: IConfigProviderInternet;
}

export interface IConfigProviders {
  endpoints?: IConfigProviderEndpointsNamed;
  internet?: IConfigProviderInternetNamed;
  firewall?: IConfigProviderFirewallNamed;
}

/*
 ****** vpns:
 */

export interface IConfigVpnTunnelOptions {
  tunnelInsideCidr: string;
}

export type IConfigVpnStyles = "transitGatewayAttached";
export interface IConfigVpn {
  style: IConfigVpnStyles;
  existingCustomerGatewayId?: string;
  newCustomerGatewayIp?: string;
  newCustomerGatewayAsn?: number;
  newCustomerGatewayName?: string;
  tunnelOneOptions?: IConfigVpnTunnelOptions;
  tunnelTwoOptions?: IConfigVpnTunnelOptions;
  existingVpnConnectionId?: string;
  existingVpnTransitGatewayAttachId?: string;
  existingVpnTransitGatewayRouteTableId?: string;
  useTransit: string;
}

export interface IConfigVpns {
  [key: string]: IConfigVpn;
}

/*
 ****** dns:
 */

export interface IConfigDnsShareWithExistingVpc {
  vpcId: string;
  vpcRegion: string;
}

export interface IConfigDnsEntry {
  domains: Array<string>;
  shareWithVpcs?: Array<string>;
  shareWithExistingVpcs?: Array<IConfigDnsShareWithExistingVpc>;
}

export interface IConfigDns {
  [key: string]: IConfigDnsEntry;
}

/*
 ****** vpcs:
 */

export interface IConfigVpcSubnet {
  cidrMask: number;
  sharedWith?: Array<string | number>;
}

export interface IConfigVpcNamedSubnets {
  [key: string]: IConfigVpcSubnet;
}

export type IConfigVpcStyles = "workloadIsolated" | "workloadPublic";
export interface IConfigVpc {
  vpcCidr: string;
  availabilityZones?: Array<string>;
  style: IConfigVpcStyles;
  subnets: IConfigVpcNamedSubnets;
  attachTgw?: boolean;
  providerEndpoints?: string;
  providerInternet?: string;
}

export interface IConfigVpcs {
  [key: string]: IConfigVpc;
}

/*
 ******* TransitGateways
 */

export interface IConfigTgwDefaultRoutes {
  vpcName: string;
  routesTo: string;
  inspectedBy?: string;
}

export interface IConfigTgwDynamicRoutes {
  vpcName: string;
  routesTo: string;
  inspectedBy?: string;
}

export interface IConfigTgwStaticRoutes {
  vpcName: string;
  staticCidr: string;
  routesTo: string;
  inspectedBy?: string;
}

export interface IConfigTgwBlackholeRoutes {
  vpcName: string;
  blackholeCidrs: Array<string>;
}

export type IConfigTgwStyles = "transitGateway";

export interface IConfigTgwRoutes {
  style: IConfigTgwStyles;
  tgwDescription: string;
  useExistingTgwId?: string;
  amazonSideAsn?: number;
  defaultRoutes?: Array<IConfigTgwDefaultRoutes>;
  dynamicRoutes?: Array<IConfigTgwDynamicRoutes>;
  staticRoutes?: Array<IConfigTgwStaticRoutes>;
  blackholeRoutes?: Array<IConfigTgwBlackholeRoutes>;
}

export interface IConfigTgws {
  [key: string]: IConfigTgwRoutes;
}

/*
 ******* Config
 */

export interface IConfig {
  global: IConfigGlobal;
  providers?: IConfigProviders;
  vpcs: IConfigVpcs;
  vpns?: IConfigVpns;
  dns?: IConfigDns;
  transitGateways?: IConfigTgws;
}
