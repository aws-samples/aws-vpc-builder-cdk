import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {
  IBuilderVpc,
  IBuilderVpn,
  IVpcSubnetParameterNames,
  IVpcParameterNames,
  INamedSubnet,
  ITgwPropagateRouteAttachmentName,
  ssmParameterImport,
} from "./types";
import { BuilderVpc } from "./abstract-buildervpc";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";

const md5 = require("md5");

// TODO Add more to this as they are implemented
export type tgwAttachmentsAndRouteTypes = IBuilderVpc | IBuilderVpn;

export interface ITransitGatewayRoutesProps extends cdk.StackProps {
  tgwAttachmentsAndRoutes: Array<tgwAttachmentsAndRouteTypes>;
}

interface tgwSetupStaticOrDefaultRouteProps {
  attachable: IBuilderVpc | IBuilderVpn;
  routeTo: IBuilderVpc | IBuilderVpn;
  inspectBy: IBuilderVpc | IBuilderVpn | undefined;
  destCidr: string;
  routeStyle: "static" | "default";
}

export class TransitGatewayRoutesStack extends cdk.Stack {
  tgwStaticRoutesCR: cr.Provider;
  props: ITransitGatewayRoutesProps;

  constructor(scope: Construct, id: string, props: ITransitGatewayRoutesProps) {
    super(scope, id, props);
    this.props = props;

    // Establish return paths, and any inspection paths for routes
    this.configurePropagatedRelationships();

    const tgwStaticRoutesCRFunction = new nodeLambda.NodejsFunction(
      this,
      "tgwStaticRoutesCRFunction",
      {
        entry: "lambda/transitGatewayRemoveStaticRoute/index.ts",
        handler: "onEvent",
      }
    );
    tgwStaticRoutesCRFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:CreateTransitGatewayRoute",
          "ec2:DeleteTransitGatewayRoute",
          "ec2:ReplaceTransitGatewayRoute",
        ],
        resources: ["*"],
      })
    );
    this.tgwStaticRoutesCR = new cr.Provider(this, "tgwStaticRoutesCRBackend", {
      onEventHandler: tgwStaticRoutesCRFunction,
    });

    // Vpc Specific activity to route subnets back to the Transit Gateway only for our IBuilderVpcs
    props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      // Check for a VPC Style attachable.  These are to route back to our TGWs
      if (attachable instanceof BuilderVpc) {
        if (attachable.withTgw && attachable.tgwAttachType == "vpc") {
          // natEgress PublicSubnet routes back the CIDR of the peer to the TGW
          if (attachable.vpcStyle == "natEgress") {
            this.vpcNatEgressSubnetRoutes(attachable);
          }
          // serviceInterfaceEndpoint and route53ResolverEndpoint PrivateIsolatedSubnet routes back to the TGW for handling
          if (
            attachable.vpcStyle == "serviceInterfaceEndpoint" ||
            attachable.vpcStyle == "route53ResolverEndpoint"
          ) {
            this.vpcInterfaceEndpointSubnetRoutes(attachable);
          }
          // awsNetworkFirewall *AwsNetworkFirewall routes back to the CIDR of the peer to TGW
          if (attachable.vpcStyle == "awsNetworkFirewall") {
            this.vpcAwsNetworkFirewallSubnetRoutes(attachable);
          }
          // workloadIsolated All Subnets route back to the CIDR of the peer to TGW
          if (
            attachable.vpcStyle == "workloadIsolated" ||
            attachable.vpcStyle == "workloadPublic"
          ) {
            this.vpcWorkloadSubnetRoutes(attachable);
          }
        }
        this.vpcRemoveDuplicateSubnetNames(attachable);
      }
    });

    // Now we've configured subnets back to TGWs as needed.  Lets handle our TGW Routes.

    // First time through we will execute our static relationship (default / static routes) since
    // they can assert a propagated / dynamic relationship when inspection needs to be performed
    props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      if (attachable.withTgw) {
        // Configure any TGW static routes for this VPC
        this.tgwSetupStaticRoutes(attachable);
        // Configure any TGW black holes in place for this VPC
        this.tgwSetupBlackHoles(attachable);
        // Configure a default TGW route if we've got one defined
        this.tgwSetupDefaultRoute(attachable);
      }
    });
    // Now we can process our propagations / dynamic routes
    props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      if (attachable.withTgw) {
        // Our Static route building may have established new propagations and possible introduced dupes.
        // Re-run our propagation logic to establish return paths and de-duplicate again.
        this.removeDuplicates();
        this.removeRoutesSelf();
        // Configure any TGW routing propagations in place for this VPC
        this.tgwSetupAttachmentPropagations(attachable);
      }
    });
  }

  vpcSubnets(
    attachable: IBuilderVpc,
    subnetType: "public" | "private" | "privateIsolated" | "privateAll" | "all"
  ) {
    let subnets: Array<INamedSubnet> = [];

    // More clever way to do this?
    if (subnetType == "public" || subnetType == "all") {
      attachable.publicSubnetNames.forEach((subnetName) => {
        attachable.vpc
          .selectSubnets({ subnetGroupName: subnetName })
          .subnets.forEach((subnet) => {
            subnets.push({
              name: subnetName,
              subnet: subnet as ec2.Subnet,
            });
          });
      });
    }
    if (
      subnetType == "private" ||
      subnetType == "privateAll" ||
      subnetType == "all"
    ) {
      attachable.privateSubnetNames.forEach((subnetName) => {
        attachable.vpc
          .selectSubnets({ subnetGroupName: subnetName })
          .subnets.forEach((subnet) => {
            subnets.push({
              name: subnetName,
              subnet: subnet as ec2.Subnet,
            });
          });
      });
    }
    if (
      subnetType == "privateIsolated" ||
      subnetType == "privateAll" ||
      subnetType == "all"
    ) {
      attachable.privateIsolatedSubnetNames.forEach((subnetName) => {
        attachable.vpc
          .selectSubnets({ subnetGroupName: subnetName })
          .subnets.forEach((subnet) => {
            subnets.push({
              name: subnetName,
              subnet: subnet as ec2.Subnet,
            });
          });
      });
    }
    return subnets;
  }

  // NAT Egress Public Subnets need a route back to the VPCs it is providing egress services for
  // Back to the Transit gateway so it can get it back to the VPC
  // Default routes are in place already to the NAT Gateways and IGW.  Don't change them!
  vpcNatEgressSubnetRoutes(attachable: IBuilderVpc) {
    this.vpcSubnets(attachable, "public").forEach((namedSubnet) => {
      this.subnetRouteBetweenAttachments(attachable, namedSubnet);
    });
  }

  // Interface Endpoint private or isolated private subnets route back to the TGW to then route to the VPCs they service
  vpcInterfaceEndpointSubnetRoutes(attachable: IBuilderVpc) {
    this.vpcSubnets(attachable, "privateAll").forEach((namedSubnet) => {
      this.subnetRouteDefaultToTGW(attachable, namedSubnet);
    });
  }

  // Workload private subnets all route back to the TGW for handling
  // Workload public subnets route specific back to TGW for handling.  Default route must remain the IGW to function.
  // If a TGW default route exists, we will get our subnets back to the TGW as well
  vpcWorkloadSubnetRoutes(attachable: IBuilderVpc) {
    // Public subnets can have dynamic routes and static routes to the TGW.  Default route must remain to the IGW.
    this.vpcSubnets(attachable, "public").forEach((namedSubnet) => {
      this.subnetRouteBetweenAttachments(attachable, namedSubnet);
      // configures any static routes that were defined
      if (attachable.tgwStaticRoutes.length) {
        this.subnetRouteToStatic(attachable, namedSubnet);
      }
    });
    // All private subnet routes go back to the TGW for handling as appropriate
    this.vpcSubnets(attachable, "privateAll").forEach((namedSubnet) => {
      this.subnetRouteDefaultToTGW(attachable, namedSubnet);
    });
  }

  // Network firewall Subnets (not the TGW Subnets) route back to TGW for handling always.
  vpcAwsNetworkFirewallSubnetRoutes(attachable: IBuilderVpc) {
    const vpc = attachable.vpc;
    vpc
      .selectSubnets({ subnetGroupName: "firewall-services" })
      .subnets.forEach((subnet) => {
        const namedSubnet: INamedSubnet = {
          name: "firewall-services",
          subnet: subnet as ec2.Subnet,
        };
        this.subnetRouteDefaultToTGW(attachable, namedSubnet);
      });
  }

  // Non-inspect:  Forward: Source -> Propagation -> Dest.
  //               Return: Dest -> Propagation -> Source
  // Inspect:  Forward: Source -> Static CIDR of Dest -> Inspect.  Inspect -> Propagation -> Dest.
  //           Return: Dest -> Static CIDR of Source -> Inspect.  Inspect -> Propagation -> Source
  tgwSetupAttachmentPropagations(attachable: IBuilderVpc | IBuilderVpn) {
    const vpcName = attachable.name;
    attachable.tgwPropagateRouteAttachmentNames.forEach((attachmentName) => {
      const attachTo = attachmentName.attachTo;
      const inspectBy = attachmentName.inspectBy;
      const routeName = attachTo.name;
      const tgwRouteTableId = this.insertSsmToken(attachable.tgwRouteTableSsm);
      if (inspectBy) {
        // Since our use case requires knowing source and dest CIDRs we only support BuilderVpc where that can be known
        if (attachTo instanceof BuilderVpc) {
          // When source is our attachable: Source -> Static CIDR of Dest -> Inspect.
          // When dest is our attachable: Dest -> Static CIDR of Source -> Inspect.
          const destinationCidrBlock = this.vpcAttachableSsmParameter(
            attachTo,
            "vpcCidr"
          );
          const transitGatewayAttachmentId = inspectBy.tgwAttachment.attrId;
          const transitGatewayRouteProps: ec2.CfnTransitGatewayRouteProps = {
            transitGatewayAttachmentId: transitGatewayAttachmentId,
            destinationCidrBlock: destinationCidrBlock.token,
            transitGatewayRouteTableId: tgwRouteTableId.token!,
          };
          new cdk.CustomResource(
            this,
            `TGWInspectionStaticRouteCR-${vpcName}-to-${routeName}`,
            {
              properties: transitGatewayRouteProps,
              serviceToken: this.tgwStaticRoutesCR.serviceToken,
            }
          );
        } else {
          throw new Error(
            "InspectBy for dynamic routes currently not available for non-VPC destined traffic."
          );
        }
      } else {
        const transitGatewayAttachmentId = attachTo.tgwAttachment.attrId;
        const tgwRouteTableId = attachable.tgwRouteTableSsm;
        new ec2.CfnTransitGatewayRouteTablePropagation(
          this,
          `TGWPropRoute-${vpcName}-to-${routeName}`,
          {
            transitGatewayAttachmentId: transitGatewayAttachmentId,
            transitGatewayRouteTableId: tgwRouteTableId.token!,
          }
        );
      }
    });
  }

  tgwSetupBlackHoles(attachable: IBuilderVpc | IBuilderVpn) {
    const vpcName = attachable.name;
    attachable.tgwBlackHoleCidrs.forEach((blackHoleCidr) => {
      const tgwRouteTableId = this.insertSsmToken(attachable.tgwRouteTableSsm);
      const cfnRouteId = "BlackHole" + md5(`${vpcName}-${blackHoleCidr}`);
      // No helper for this one as a blackhole has no attachment so nothing can change
      new ec2.CfnTransitGatewayRoute(this, cfnRouteId, {
        blackhole: true,
        destinationCidrBlock: blackHoleCidr,
        transitGatewayRouteTableId: tgwRouteTableId.token!,
      });
    });
  }

  // Configure our default route unless we have a conflicting 'inspected' route.  Inspected route should be preferred.
  tgwSetupDefaultRoute(attachable: IBuilderVpc | IBuilderVpn) {
    // Where we have an inspected attachment but also the same attachment as the default route, remove the default route.
    if (attachable.tgwDefaultRouteAttachmentName) {
      if (
        this.defaultRouteOverrideByInspection(
          attachable.tgwPropagateRouteAttachmentNames,
          attachable.tgwDefaultRouteAttachmentName
        )
      ) {
        attachable.tgwDefaultRouteAttachmentName = undefined;
      }
    }
    if (attachable.tgwDefaultRouteAttachmentName) {
      this.tgwSetupStaticOrDefaultRoute({
        attachable: attachable,
        routeTo: attachable.tgwDefaultRouteAttachmentName.attachTo,
        inspectBy: attachable.tgwDefaultRouteAttachmentName.inspectBy,
        destCidr: "0.0.0.0/0",
        routeStyle: "default",
      });
    }
  }

  // Static routes we iterate through multiples, same logic as a default though.
  tgwSetupStaticRoutes(attachable: IBuilderVpc | IBuilderVpn) {
    attachable.tgwStaticRoutes.forEach((staticRoute) => {
      this.tgwSetupStaticOrDefaultRoute({
        attachable: attachable,
        routeTo: staticRoute.attachTo,
        inspectBy: staticRoute.inspectBy,
        destCidr: staticRoute.cidrAddress,
        routeStyle: "static",
      });
    });
  }

  // Non-inspect.  Forward: Source -> Dest CIDR -> Dest.
  //               Reverse: Dest -> Propagation -> Source
  // Inspect:  Forward: Source -> Dest CIDR -> Inspect.  Inspect -> Propagation -> Dest.
  //           Reverse: Dest -> Source CIDR -> Inspect.  Inspect -> Propagation -> Source.
  tgwSetupStaticOrDefaultRoute(props: tgwSetupStaticOrDefaultRouteProps) {
    const vpcName = props.attachable.name;
    let transitGatewayAttachmentId = props.routeTo.tgwAttachment.attrId;
    // When inspected our route will be toward the inspecting VPC and not the actual defaultTo vpc
    if (props.inspectBy) {
      // Our Attachment will be the VPC that performs inspection
      transitGatewayAttachmentId = props.inspectBy.tgwAttachment.attrId;
      // Inspect -> Propagation -> Dest
      props.inspectBy.tgwPropagateRouteAttachmentNames.push({
        attachTo: props.routeTo,
      });
      // Dest -> Source CIDR -> Inspect.
      // ** this will be handled by tgwSetupAttachmentPropagations as it is common in that route use case **
      // Critical that we propagate the inspectBy for this attachment so it uses a static route back.
      props.routeTo.tgwPropagateRouteAttachmentNames.push({
        attachTo: props.attachable,
        inspectBy: props.inspectBy,
      });
      // Inspect -> Propagation -> Source
      props.inspectBy.tgwPropagateRouteAttachmentNames.push({
        attachTo: props.attachable,
      });
    } else {
      // Dest -> Propagation -> Source
      props.routeTo.tgwPropagateRouteAttachmentNames.push({
        attachTo: props.attachable,
      });
    }
    const tgwRouteTableId = this.insertSsmToken(
      props.attachable.tgwRouteTableSsm
    );
    // Source -> DestCidr -> Inspect.
    const transitGatewayRouteProps: ec2.CfnTransitGatewayRouteProps = {
      transitGatewayAttachmentId: transitGatewayAttachmentId,
      destinationCidrBlock: props.destCidr,
      transitGatewayRouteTableId: tgwRouteTableId.token!,
    };
    // Our static routes require a bit more diversity to assure they are unique within our template
    // We will also prefix them so we know what they are in the CFN Console.
    let routeId =
      "StaticRouteCR" +
      md5(`${vpcName}-${props.destCidr}-${props.routeTo.name}`);
    if (props.routeStyle == "default") {
      routeId = "TGWDefaultCR" + md5(tgwRouteTableId.name);
    }
    // Static / Default route updates aren't handled by CloudFormation correctly at present
    new cdk.CustomResource(this, routeId, {
      properties: transitGatewayRouteProps,
      serviceToken: this.tgwStaticRoutesCR.serviceToken,
    });
  }

  subnetRouteDefaultToTGW(attachable: IBuilderVpc, namedSubnet: INamedSubnet) {
    // The route table of our subnet
    const subnetRouteTableId = this.subnetAttachableSsmParameter(
      attachable,
      namedSubnet.name,
      namedSubnet.subnet.availabilityZone,
      "routeTableId"
    );
    // Unique ID based on the route Table ID which can have only one default entry
    const routeId = `ToTGWDefault${md5(subnetRouteTableId.name)}`;
    new ec2.CfnRoute(this, routeId, {
      destinationCidrBlock: "0.0.0.0/0",
      transitGatewayId: attachable.tgw.attrId,
      routeTableId: subnetRouteTableId.token!,
    });
  }

  subnetRouteToStatic(attachable: IBuilderVpc, namedSubnet: INamedSubnet) {
    const vpcName = attachable.name;
    attachable.tgwStaticRoutes.forEach((staticRoute) => {
      const staticCidrAddress = staticRoute.cidrAddress;
      const routeTableId = this.subnetAttachableSsmParameter(
        attachable,
        namedSubnet.name,
        namedSubnet.subnet.availabilityZone,
        "routeTableId"
      );
      const routeId =
        "toTGWCidr" + md5(`${vpcName}${staticCidrAddress}${routeTableId.name}`);
      new ec2.CfnRoute(this, routeId, {
        destinationCidrBlock: staticCidrAddress,
        transitGatewayId: attachable.tgw.attrId,
        routeTableId: routeTableId.token!,
      });
    });
  }

  subnetRouteBetweenAttachments(
    attachable: IBuilderVpc,
    namedSubnet: INamedSubnet,
    defaultRoute?: ITgwPropagateRouteAttachmentName
  ) {
    attachable.tgwPropagateRouteAttachmentNames.forEach((attachmentName) => {
      const vpcName = attachable.name;
      // May already be addressed by a default route which is preferred
      if (defaultRoute) {
        if (defaultRoute.attachTo.name == attachmentName.attachTo.name) {
          return;
        }
        // This is addressed by a default route via inspection
        if (
          defaultRoute.inspectBy &&
          defaultRoute.inspectBy.name == attachmentName.attachTo.name
        ) {
          return;
        }
      }
      // This approach works for Vpc propagated to Vpc attachments since we know the CIDR addresses of the VPCs
      if (attachmentName.attachTo instanceof BuilderVpc) {
        let attachCidr = this.vpcAttachableSsmParameter(
          attachmentName.attachTo,
          "vpcCidr"
        );

        const egressSubnetRtId = this.subnetAttachableSsmParameter(
          attachable,
          namedSubnet.name,
          namedSubnet.subnet.availabilityZone,
          "routeTableId"
        );
        // The Subnet CIDR block of our subnet (to construct a unique ID)
        const egressSubnetCidr = this.subnetAttachableSsmParameter(
          attachable,
          namedSubnet.name,
          namedSubnet.subnet.availabilityZone,
          "subnetCidr"
        );
        // A unique identifier for this Route
        const routeId =
          "toTGWCidr" +
          md5(`${vpcName}${egressSubnetCidr.name}${attachCidr.name}`);
        new ec2.CfnRoute(this, routeId, {
          destinationCidrBlock: attachCidr.token,
          transitGatewayId: attachable.tgw.attrId,
          routeTableId: egressSubnetRtId.token!,
        });
      }
    });
  }

  insertSsmToken(ssmParameter: ssmParameterImport): ssmParameterImport {
    ssmParameter.token = ssm.StringParameter.valueForStringParameter(
      this,
      ssmParameter.name
    );
    return ssmParameter;
  }

  vpcAttachableSsmParameter(
    attachable: IBuilderVpc,
    parameterName: IVpcParameterNames
  ): ssmParameterImport {
    let parameter: ssmParameterImport;
    parameter = {
      name: `${attachable.ssmParameterPaths[parameterName]}`,
      token: ssm.StringParameter.valueForStringParameter(
        this,
        `${attachable.ssmParameterPaths[parameterName]}`
      ),
    };
    if (!parameter) {
      throw new Error(
        `Unable to find SSM path for ${attachable.name} parameter ${parameterName}`
      );
    }
    return parameter;
  }

  subnetAttachableSsmParameter(
    attachable: IBuilderVpc,
    subnetName: string,
    availabilityZone: string,
    parameterName: IVpcSubnetParameterNames
  ): ssmParameterImport {
    const filteredSubnets = attachable.ssmParameterPaths.subnets.filter(
      (subnet) => subnet.subnetName == subnetName
    );
    let parameter: ssmParameterImport | undefined;
    filteredSubnets.forEach((subnet) => {
      if (subnet.availabilityZone == availabilityZone) {
        parameter = {
          name: `${subnet[parameterName]}`,
          token: ssm.StringParameter.valueForStringParameter(
            this,
            `${subnet[parameterName]}`
          ),
        };
      }
    });
    if (!parameter) {
      throw new Error(
        `Unable to find SSM path for ${attachable.name} subnet ${subnetName} availability zone ${availabilityZone} parameter ${parameterName}`
      );
    }
    return parameter;
  }

  // Where an attachable has a propagation to another attachable assure they both reflect this.
  // Where inspection is configured assure the firewall is made aware of the routes
  configurePropagatedRelationships() {
    // First pass will be any non default route relationship to and from
    this.props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      attachable.tgwPropagateRouteAttachmentNames.forEach(
        (tgwPropagateRouteAttachmentName) => {
          this.configureRouteRelationshipsPropagate(
            attachable,
            tgwPropagateRouteAttachmentName
          );
        }
      );
    });
    // Second pass will be any default route relationships which need a path back
    this.props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      // Default route propagations if configured
      if (attachable.tgwDefaultRouteAttachmentName) {
        this.configureRouteRelationshipsPropagate(
          attachable,
          attachable.tgwDefaultRouteAttachmentName
        );
      }
    });
    // De-duplicate after all our relationship building
    this.removeDuplicates();
  }

  configureRouteRelationshipsPropagate(
    attachable: tgwAttachmentsAndRouteTypes,
    tgwPropagateRouteAttachmentName: ITgwPropagateRouteAttachmentName
  ) {
    // Propagate cidr to cidr connections to our peers
    const routeBack: ITgwPropagateRouteAttachmentName = {
      attachTo: attachable,
      inspectBy: tgwPropagateRouteAttachmentName.inspectBy,
    };
    tgwPropagateRouteAttachmentName.attachTo.tgwPropagateRouteAttachmentNames.push(
      routeBack
    );

    // When we're inspected by propagate cidr to cidr to our firewall
    if (tgwPropagateRouteAttachmentName.inspectBy) {
      if (tgwPropagateRouteAttachmentName.inspectBy instanceof BuilderVpc) {
        if (tgwPropagateRouteAttachmentName.inspectBy.vpcInspects) {
          const inspectRouteBack: ITgwPropagateRouteAttachmentName = {
            attachTo: attachable,
          };
          tgwPropagateRouteAttachmentName.inspectBy.tgwPropagateRouteAttachmentNames.push(
            inspectRouteBack
          );
        } else {
          throw new Error(
            `${attachable.name} expects inspection by ${tgwPropagateRouteAttachmentName.inspectBy} but this vpc does not advertise inspection capabilities.`
          );
        }
      } else {
        throw new Error(`Inspection by VPN is not supported`);
      }
    }
  }

  // De-Dupe subnet-names we might have
  vpcRemoveDuplicateSubnetNames(attachable: IBuilderVpc) {
    attachable.publicSubnetNames = [...new Set(attachable.publicSubnetNames)];
    attachable.privateSubnetNames = [...new Set(attachable.privateSubnetNames)];
    attachable.privateIsolatedSubnetNames = [
      ...new Set(attachable.privateIsolatedSubnetNames),
    ];
  }

  // De-dupe tgwPropagateRouteAttachmentNames, tgwBlackHoleCidrs, tgwStaticRoutes
  removeDuplicates() {
    // tgwPropagateRouteAttachmentNames: Array<string>
    // tgwBlackHoleCidrs: Array<string>
    // tgwStaticRoutes: Array<IBuilderTgwStaticRoutes>
    this.props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      // Remove any duplicates that snuck in our transitive routing objects
      attachable.tgwPropagateRouteAttachmentNames = this.deDupeTgwAttachments(
        attachable.tgwPropagateRouteAttachmentNames
      );
      // The remainders are simply arrays of strings so we can use a Set.
      attachable.tgwBlackHoleCidrs = [...new Set(attachable.tgwBlackHoleCidrs)];
      attachable.tgwStaticRoutes = [...new Set(attachable.tgwStaticRoutes)];
    });
  }

  removeRoutesSelf() {
    // tgwPropagateRouteAttachmentNames: Array<string>
    // tgwBlackHoleCidrs: Array<string>
    // tgwStaticRoutes: Array<IBuilderTgwStaticRoutes>
    this.props.tgwAttachmentsAndRoutes.forEach((attachable) => {
      // Where the same attachment exists but one prefers inspection, prefer inspection.
      attachable.tgwPropagateRouteAttachmentNames =
        this.preferInspectedTgwAttachments(
          attachable.tgwPropagateRouteAttachmentNames
        );
      // A self reference may have snuck in as well, filter those out
      attachable.tgwPropagateRouteAttachmentNames =
        attachable.tgwPropagateRouteAttachmentNames.filter(
          (tgwPropagateRouteAttachmentName) =>
            tgwPropagateRouteAttachmentName.attachTo.name != attachable.name
        );
    });
  }

  deDupeTgwAttachments(toDeDupe: Array<ITgwPropagateRouteAttachmentName>) {
    const deDuped: Array<ITgwPropagateRouteAttachmentName> = toDeDupe.filter(
      (thing, index, self) =>
        index ===
        self.findIndex(
          (t) =>
            t.attachTo.name === thing.attachTo.name &&
            t.inspectBy?.name === thing.inspectBy?.name
        )
    );
    return deDuped;
  }

  preferInspectedTgwAttachments(
    toReview: Array<ITgwPropagateRouteAttachmentName>
  ) {
    // List of attachments that have inspection.  We'll add the ones that don't to this.
    const inspectedList: Array<ITgwPropagateRouteAttachmentName> = [];
    // Attachment Names that have an inspection configured
    const inspectedAttachmentNames: Array<string> = [];
    toReview.forEach((routeAttachmentName) => {
      if (routeAttachmentName.inspectBy) {
        inspectedAttachmentNames.push(routeAttachmentName.attachTo.name);
      }
    });
    // Now we'll build a list by preferring the attachment names that have inspections versus not
    toReview.filter((routeAttachmentName) => {
      if (
        inspectedAttachmentNames.includes(routeAttachmentName.attachTo.name)
      ) {
        // Inspection is preferred, if the row we're reviewing has an inspectBy then push it to our list
        if (routeAttachmentName.inspectBy) {
          inspectedList.push(routeAttachmentName);
        }
      } else {
        // Inspection is not preferred we can push what we have.
        inspectedList.push(routeAttachmentName);
      }
    });
    return inspectedList;
  }

  defaultRouteOverrideByInspection(
    dynamicPropagations: Array<ITgwPropagateRouteAttachmentName>,
    defaultRoute: ITgwPropagateRouteAttachmentName
  ): boolean {
    // If we have a default route configured, and a dynamic route that is inspected, we should remove the default route
    let found = false;
    dynamicPropagations.forEach((dynamicAttachName) => {
      if (dynamicAttachName.inspectBy) {
        if (dynamicAttachName.attachTo == defaultRoute.attachTo) {
          found = true;
        }
      }
    });
    return found;
  }
}
