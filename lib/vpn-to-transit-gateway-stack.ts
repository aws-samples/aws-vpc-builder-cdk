import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cr from "aws-cdk-lib/custom-resources";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import {
  IBuilderVpnProvides,
  IBuilderVpnStyle,
  IBuilderVpnProps,
  ICustomResourceTGWFindVpnAttach,
  ITgw,
} from "./types";
import { BuilderVpn } from "./abstract-buildervpn";
import * as iam from "aws-cdk-lib/aws-iam";
import { IConfigVpnTunnelOptions } from "./config/config-types";

export interface IVpnToTransitGatewayProps extends IBuilderVpnProps {
  tgw: ITgw;
  existingCustomerGatewayId?: string;
  newCustomerGatewayIpAddress?: string;
  newCustomerGatewayAsn?: number;
  newCustomerGatewayName?: string;
  existingVpnConnectionId?: string;
  existingVpnTransitGatewayAttachId?: string;
  existingVpnTransitGatewayRouteTableId?: string;
}

// The CDK version of this is readonly for some reason?
interface VpnTunnelOptionsSpecificationProperty {
  preSharedKey?: string;
  tunnelInsideCidr?: string;
}

export class VpnToTransitGatewayStack extends BuilderVpn {
  vpnStyle: IBuilderVpnStyle = "transitGatewayAttached";
  vpnProvides: IBuilderVpnProvides = "amazonManagedVpn";
  withTgw: boolean = true;
  tgwAttachType: "vpn";
  customerGateway: ec2.CfnCustomerGateway;
  customerGatewayId: string;
  props: IVpnToTransitGatewayProps;
  findVpnTgwAttachCR: cr.Provider;

  constructor(scope: Construct, id: string, props: IVpnToTransitGatewayProps) {
    super(scope, id, props);

    this.name = `${props.namePrefix}-vpn`.toLowerCase();

    // Determine if we're handling an import or creating a new resource
    if (this.props.existingVpnConnectionId) {
      if (!this.props.existingVpnTransitGatewayAttachId) {
        throw new Error(
          "Importing an existing VPN requires existingVpnTransitGatewayAttachId to be defined"
        );
      }
      if (!this.props.existingVpnTransitGatewayRouteTableId) {
        throw new Error(
          "Importing an existing VPN requires existingVpnTransitGatewayRouteTableId to be defined"
        );
      }
      // Verified our base properties exist, now we can do our import
      this.vpn = {
        ref: this.props.existingVpnConnectionId,
      };
      this.tgwRouteTable = {
        ref: this.props.existingVpnTransitGatewayRouteTableId,
      };
      this.tgwAttachment = {
        attrId: this.props.existingVpnTransitGatewayAttachId,
      };
    } else {
      if (props.existingCustomerGatewayId) {
        this.customerGatewayId = props.existingCustomerGatewayId;
      } else {
        this.createNewCustomerGateway();
      }
      // There is no property on the VPN connection that gives us our Transit Gateway Attachment which we need for routing
      // So we need to use a custom resources which describes the connection and gets the attachmentId so we can make a route table.
      const findVpnTgwAttachIdCRFunction = new nodeLambda.NodejsFunction(
        this,
        "findVpnTgwAttachIdCRFunction",
        {
          entry: "lambda/findVpnTransitGatewayAttachId/index.ts",
          handler: "onEvent",
        }
      );
      findVpnTgwAttachIdCRFunction.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ec2:DescribeTransitGatewayAttachments"],
          resources: ["*"],
        })
      );
      this.findVpnTgwAttachCR = new cr.Provider(
        this,
        "findVpnTgwAttachCRBackend",
        {
          onEventHandler: findVpnTgwAttachIdCRFunction,
        }
      );

      //  Ugliness of this code is mostly a workaround for 'vpnTunnelOptionsSpecifications' being readonly in the CDK
      let vpnPropsBase: ec2.CfnVPNConnectionProps = {
        customerGatewayId: this.customerGatewayId,
        tags: [
          {
            key: "Name",
            value: `${this.name}`,
          },
        ],
        type: "ipsec.1",
        transitGatewayId: props.tgw.attrId,
      };
      let vpnProps: ec2.CfnVPNConnectionProps = {
        ...vpnPropsBase,
      };

      // If tunnel options exist, we will need to add them to our props
      if (props.tunnelOneOptions || props.tunnelTwoOptions) {
        vpnProps = {
          ...vpnPropsBase,
          vpnTunnelOptionsSpecifications: [
            this.buildTunnelOptions(props.tunnelOneOptions),
            this.buildTunnelOptions(props.tunnelTwoOptions),
          ],
        };
      }

      this.vpn = new ec2.CfnVPNConnection(this, "VpnConnection", vpnProps);

      const findVpnTgwAttachRequest: ICustomResourceTGWFindVpnAttach = {
        transitGatewayId: props.tgw.attrId,
        vpnId: this.vpn.ref,
      };

      const transitGatewayAttachId = new cdk.CustomResource(
        this,
        "FindVpnTgwAttachId",
        {
          properties: findVpnTgwAttachRequest,
          serviceToken: this.findVpnTgwAttachCR.serviceToken,
        }
      );

      this.tgwAttachment = {
        attrId: transitGatewayAttachId.getAttString("transitGatewayAttachId"),
      };
    }
  }

  createNewCustomerGateway() {
    if (
      !this.props.newCustomerGatewayIpAddress &&
      !this.props.newCustomerGatewayAsn
    ) {
      throw new Error(
        "No existingCustomerGatewayId provided.  Creating a new one requires newCustomerGatewayIpAddress and newCustomerGatewayAsn to be set"
      );
    }
    let customerGatewayName = `${this.name}-customer-gateway`;
    if (this.props.newCustomerGatewayName) {
      customerGatewayName = `${this.props.newCustomerGatewayName}-customer-gateway`;
    }
    this.customerGateway = new ec2.CfnCustomerGateway(
      this,
      "VpnCustomerGateway",
      {
        bgpAsn: this.props.newCustomerGatewayAsn!,
        ipAddress: this.props.newCustomerGatewayIpAddress!,
        type: "ipsec.1",
        tags: [
          {
            key: "Name",
            value: customerGatewayName,
          },
        ],
      }
    );
    this.customerGatewayId = this.customerGateway.ref;
  }

  buildTunnelOptions(tunnelConfiguration: IConfigVpnTunnelOptions | undefined) {
    let tunnelOptions: VpnTunnelOptionsSpecificationProperty = {
      // Don't do this unless we can get it from a secret
      preSharedKey: undefined,
      tunnelInsideCidr: undefined,
    };

    // If we have specifics for this tunnel we will configure them
    if (tunnelConfiguration) {
      // NOTE That although you're able to specify the PSK for the tunnel in cloudformation it (as of today)
      // does NOT support using a 'secure string lookup' which is the only safe way to do this.  So we won't offer the option.
      // A PSK in plain-text in a CloudFormation template doesn't sit well.  Perhaps the whole VPN connection needs to be a
      // custom resource?
      if (tunnelConfiguration.tunnelInsideCidr) {
        tunnelOptions.tunnelInsideCidr = tunnelConfiguration.tunnelInsideCidr;
      }
    }

    return tunnelOptions;
  }
}
