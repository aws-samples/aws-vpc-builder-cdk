import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib/core";
import { IConfigVpnTunnelOptions } from "./config/config-types";

/*
 * Base for our Transit Gateway
 */
export type ITransitGatewayProvides = "transitGateway";
export type ITransitGatewayStyle = "transitGateway";
export interface ITransitGatewayBase {
  name: string;
  props: ITransitGatewayBaseProps;
  tgwStyle: ITransitGatewayProvides;
  provides: ITransitGatewayStyle;
  tgw: ITgw;
}

export interface ITransitGatewayBaseProps extends cdk.StackProps {
  namePrefix: string;
  tgwDescription: string;
}

/*
 * Base for anything transit gateway attached that needs to route
 */
export type ITgwAttachType = "vpc" | "vpn";
export interface ITransitGatewayAttachImport {
  attrId: string;
}
export type ITgwAttachment =
  | ec2.CfnTransitGatewayVpcAttachment
  | ITransitGatewayAttachImport;
export interface ITransitGatewayRouteImport {
  ref: string;
}
export type ITgwRouteTable =
  | ec2.CfnTransitGatewayRouteTable
  | ITransitGatewayRouteImport;
export interface ITgwImport {
  attrId: string;
}
export type ITgw = ec2.CfnTransitGateway | ITgwImport;
export interface IBuilderBase {
  name: string;
  withTgw: boolean;
  tgwAttachType: ITgwAttachType;
  globalPrefix: string;
  tgw: ITgw;
  tgwCreateTgwSubnets: boolean;
  tgwRouteTable: ITgwRouteTable;
  tgwRouteTableSsm: ssmParameterImport;
  tgwAttachment: ITgwAttachment;
  tgwAttachmentSsm: ssmParameterImport;
  tgwPropagateRouteAttachmentNames: Array<ITgwPropagateRouteAttachmentName>;
  tgwBlackHoleCidrs: Array<string>;
  tgwStaticRoutes: Array<IBuilderTgwStaticRoutes>;
  tgwDefaultRouteAttachmentName?: ITgwPropagateRouteAttachmentName;
}

export interface IBuilderBaseProps extends cdk.StackProps {
  namePrefix: string;
  globalPrefix: string;
  ssmParameterPrefix: string;
  withTgw?: boolean;
  tgw?: ITgw;
  tgwPropagateRouteAttachmentNames?: Array<ITgwPropagateRouteAttachmentName>;
  tgwBlackHoleCidrs?: Array<string>;
  tgwStaticRoutes?: Array<IBuilderTgwStaticRoutes>;
  tgwDefaultRouteAttachmentName?: ITgwPropagateRouteAttachmentName;
}

/*
 * Base VPC Class and base properties for our VPCs
 */
export type IBuilderVpcStyle =
  | "serviceInterfaceEndpoint"
  | "route53ResolverEndpoint"
  | "natEgress"
  | "awsNetworkFirewall"
  | "workloadIsolated"
  | "workloadPublic";
export type IBuildVpcProvides =
  | "endpoints"
  | "internet"
  | "firewall"
  | "workload";
export interface IBuilderVpc extends IBuilderBase {
  vpc: ec2.Vpc;
  vpcStyle: IBuilderVpcStyle;
  provides: IBuildVpcProvides;
  vpcInspects: boolean;
  ssmParameterPaths: IVpcParameterModel;
  publicSubnetNames: Array<string>;
  privateSubnetNames: Array<string>;
  privateIsolatedSubnetNames: Array<string>;
}
export interface IBuilderVpcProps extends IBuilderBaseProps {
  availabilityZones: Array<string>;
  vpcCidr: string;
  tgw?: ITgw;
}

/*
 * Common interface for our workload stacks.
 */
export interface IVpcWorkloadProps extends IBuilderVpcProps {
  createSubnets: Array<SubnetNamedMasks>;
  organizationId?: string;
}

/*
 * Base VPN Class and base properties for our VPNs
 */
export type IBuilderVpnStyle = "transitGatewayAttached";
export type IBuilderVpnProvides = "amazonManagedVpn";
export interface IVpnImport {
  ref: string;
}
export type IVpn = IVpnImport | ec2.CfnVPNConnection;
export interface IBuilderVpn extends IBuilderBase {
  vpn: IVpn;
  vpnStyle: IBuilderVpnStyle;
  vpnProvides: IBuilderVpnProvides;
  tunnelOneOptions: IConfigVpnTunnelOptions;
  tunnelTwoOptions: IConfigVpnTunnelOptions;
}
export interface IBuilderVpnProps extends IBuilderBaseProps {
  tunnelOneOptions?: IConfigVpnTunnelOptions;
  tunnelTwoOptions?: IConfigVpnTunnelOptions;
}

export interface ICustomResourceParseAwsFirewallEndpoints {
  firewallEndpoints: Array<string>;
  availabilityZone: string;
}

export interface ICustomResourceTGWStaticRoute {
  transitGatewayAttachmentId: string;
  destinationCidrBlock: string;
  transitGatewayRouteTableId: string;
}

export interface ICustomResourceTGWFindVpnAttach {
  transitGatewayId: string;
  vpnId: string;
}

export type IVpcSubnetParameterNames =
  | "subnetId"
  | "subnetCidr"
  | "routeTableId";
export interface IVpcSubnetParameterModel {
  subnetName: string;
  subnetId: string;
  subnetCidr: string;
  availabilityZone: string;
  routeTableId: string;
}

export type IVpcParameterNames =
  | "vpcId"
  | "vpcCidr"
  | "tgwAttachId"
  | "tgwRouteId"
  | "tgwId";
export interface IVpcParameterModel {
  vpcName: string;
  vpcId: string;
  vpcCidr: string;
  availabilityZones: Array<string>;
  subnets: Array<IVpcSubnetParameterModel>;
  tgwId?: string;
  tgwAttachId?: string;
  tgwRouteId?: string;
}

export interface INamedSubnet {
  name: string;
  subnet: ec2.Subnet;
}

export interface ITgwPropagateRouteAttachmentName {
  attachTo: IBuilderVpc | IBuilderVpn;
  inspectBy?: IBuilderVpc | IBuilderVpn;
}

export interface IBuilderTgwStaticRoutes
  extends ITgwPropagateRouteAttachmentName {
  cidrAddress: string;
}

export interface SubnetNamedMasks {
  name: string;
  cidrMask: number;
  sharedWith?: Array<string | number>;
}

export type ssmParameterImport = {
  name: string;
  token?: string;
};
