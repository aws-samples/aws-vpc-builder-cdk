import { IConfig, IConfigProviderEndpoints } from "./config-types";
import Ajv, { JSONSchemaType, ValidateFunction } from "ajv";
import * as configSchema from "./config-schema.json";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

const IPCidr = require("ip-cidr");

const avj = new Ajv({ allowUnionTypes: true });

export interface IConfigParserProps {
  configFilename?: string;
  configContents?: any;
}

export class ConfigParser {
  props: IConfigParserProps;
  config: IConfig;
  configRaw: any;
  configSchema: JSONSchemaType<IConfig> = configSchema as any;
  configValidator: ValidateFunction;

  constructor(props: IConfigParserProps) {
    this.props = props;
    // filename
    if (this.props.configFilename) {
      const fileRead = fs.readFileSync(
        path.join("config", `${this.props.configFilename}`),
        { encoding: "utf8" },
      ) as any;
      try {
        this.configRaw = yaml.parse(fileRead) as any;
      } catch (err) {
        throw new Error(
          `${this.props.configFilename}: Error parsing YAML. Assure all special characters in value are quoted.  ie: '*' or "*"`,
        );
      }
    } else {
      // Or direct load in the case of testcase execution
      if (this.props.configContents) {
        this.configRaw = this.props.configContents as any;
      }
      if (!this.configRaw) {
        throw new Error(
          `Either configFilename or configContents must be specified for our config parser!`,
        );
      }
    }
    this.configValidator = avj.compile(this.configSchema);
  }

  parse() {
    if (!this.configValidator(this.configRaw)) {
      throw new Error(
        `Config contains structural errors: ${JSON.stringify(
          this.configValidator.errors,
          null,
          2,
        )}`,
      );
    }
    const configRaw = this.configRaw as any;

    // ** Global Section Verifications.
    this.verifySsmPrefix();
    this.verifyDiscoveryFolder();
    // Confirm unique naming within the config file for all resources
    this.verifyResourceNamesUnique();

    // ** Providers
    if (configRaw.hasOwnProperty("providers")) {
      this.verifyProvidersTransitsExist();
      this.verifyVpcCidrsProviders();
      this.verifyProviderEndpoints();
      this.verifyInternetProviderRoutes();
    }

    //** DNS
    if (configRaw.hasOwnProperty("dns")) {
      this.dnsVerifyRequiredArguments();
    }

    //** VPNs
    if (configRaw.hasOwnProperty("vpns")) {
      this.vpnAssureRequiredArguments();
      this.verifyVpnsTransitExists();
    }

    //** DxGateways
    if (configRaw.hasOwnProperty("dxgws")) {
      this.dxGwAssureRequiredArguments();
    }

    // ** Transits
    if (configRaw.hasOwnProperty("transitGateways")) {
      this.verifyOnlyOneTransitGateway();
      this.verifyTransitGatewayOptions();
      this.tgwRouteChecks();
      this.verifyCidrsTransitGateway();
    }

    // ** VPCs
    this.verifyCidrsVpcs();
    this.verifyVpcsSubnetOptions();
    this.verifyVpcProvidersExist();
    this.verifyVpcWithNoTransitHasNoRoutes();
    // Our schema matches!  Lets load it up for further value verification.
    this.config = this.configRaw as any;
  }

  verifyVpcCidrsProviders() {
    for (const providerType of ["endpoints", "internet", "firewall"]) {
      if (this.configRaw.providers.hasOwnProperty(providerType)) {
        for (const providerName of Object.keys(
          this.configRaw.providers[providerType],
        )) {
          const configStanza =
            this.configRaw.providers[providerType][providerName];
          this.verifyCidr(configStanza.vpcCidr);
        }
      }
    }
  }

  verifyProviderEndpoints() {
    let serviceInterfaceCount = 0;
    if (this.configRaw.providers.hasOwnProperty("endpoints")) {
      for (const providerName of Object.keys(
        this.configRaw.providers["endpoints"],
      )) {
        const configStanza =
          this.configRaw.providers["endpoints"][providerName];
        if (configStanza.style == "route53ResolverEndpoint") {
          this.verifyProviderEndpointsRoute53Resolvers(
            providerName,
            configStanza,
          );
        } else if (configStanza.style == "serviceInterfaceEndpoint") {
          this.verifyProviderEndpointsServiceInterface(
            providerName,
            configStanza,
          );
          serviceInterfaceCount++;
        } else {
          throw new Error(
            `Unable to verify configuration for endpoint style ${configStanza.style}`,
          );
        }
      }
    }
    if (serviceInterfaceCount > 1) {
      throw new Error(
        `Only one endpoint provider of style 'serviceInterfaceEndpoint' is supported.`,
      );
    }
  }

  verifyProviderEndpointsRoute53Resolvers(
    providerName: string,
    configStanza: IConfigProviderEndpoints,
  ) {
    if (
      !configStanza.resolveRequestsFromCidrs &&
      !configStanza.forwardRequests
    ) {
      throw new Error(
        `Endpoint ${providerName}: Route53 resolver requires resolveRequestsFromCidrs and/or forwardRequests are specified`,
      );
    }
    if (configStanza.resolveRequestsFromCidrs) {
      for (const cidr of configStanza.resolveRequestsFromCidrs) {
        this.verifyCidr(cidr, false);
      }
    }
    if (configStanza.forwardRequests) {
      for (const ip of configStanza.forwardRequests.toIps) {
        if (!IPCidr.isValidAddress(ip)) {
          throw new Error(
            `Endpoint ${providerName}: toIp address ${ip} is not valid`,
          );
        }
        if (ip.split("/").length > 1) {
          throw new Error(
            `Endpoint ${providerName}: toIp address ${ip} must not be a CIDR address`,
          );
        }
      }
    }
  }

  verifyProviderEndpointsServiceInterface(
    providerName: string,
    configStanza: IConfigProviderEndpoints,
  ) {
    if (!configStanza.endpointConfigFile) {
      throw new Error(
        `Endpoint ${providerName}: Service interfaces requires endpointConfigFile be specified`,
      );
    }
    const interfaceListFile = `${configStanza.endpointConfigFile}-${this.configRaw.global.region}.txt`;
    if (!fs.existsSync(path.join("config", interfaceListFile))) {
      throw new Error(
        `Endpoint ${providerName}: Service interface file ${interfaceListFile} not found in the config directory`,
      );
    }
    if (configStanza.endpointMask) {
      if (configStanza.endpointMask < 16 || configStanza.endpointMask > 28) {
        throw new Error(
          `Endpoint ${providerName}: endpointMask of ${configStanza.endpointMask} was given.  Valid values are between 16 and 28`,
        );
      }
    }
  }

  verifyCidrsTransitGateway() {
    for (const transitGatewayName of Object.keys(
      this.configRaw.transitGateways,
    )) {
      const configStanza = this.configRaw.transitGateways[transitGatewayName];
      if (configStanza.blackholeRoutes) {
        console.log(`Black Hole Routes found, evaluating`);
        for (const route of configStanza.blackholeRoutes) {
          route.blackholeCidrs.forEach(
            (blackholeCidr: string, index: number) => {
              if (this.blackholeIsCidr(blackholeCidr)) {
                console.log(`${blackholeCidr} is considered a blackholecidr`);
                this.verifyCidr(blackholeCidr, false);
              } else {
                console.log(`${blackholeCidr} is not a valid cidr`);
                // Value provided is not CIDR formatted, see if it matches a VPC
                if (this.vpcNameExists(blackholeCidr)) {
                  console.log(
                    `${blackholeCidr} is considered a valid VPC Name`,
                  );
                  // We will substitute the value of our VPCs CIDR address here since the rest of our code
                  // Expects our value to be a CIDR format
                  route.blackholeCidrs[index] =
                    this.configRaw.vpcs[blackholeCidr].vpcCidr;
                } else {
                  throw new Error(
                    `blackholeRoutes contains blackholeCidr with value ${blackholeCidr}.  Not a valid CIDR Address or Vpc Name within the 'vpc:' configuration section.`,
                  );
                }
              }
            },
          );
        }
      }
      if (configStanza.staticRoutes) {
        for (const route of configStanza.staticRoutes) {
          this.verifyCidr(route.staticCidr, false);
        }
      }
    }
  }

  // As per: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ec2-vpnconnection-vpntunneloptionsspecification.html#cfn-ec2-vpnconnection-vpntunneloptionsspecification-tunnelinsidecidr
  verifyTunnelInsideCidrs(cidr: string) {
    const amazonReservedInsideCidrs = [
      "169.254.0.0/30",
      "169.254.1.0/30",
      "169.254.2.0/30",
      "169.254.3.0/30",
      "169.254.4.0/30",
      "169.254.5.0/30",
      "169.254.169.252/30",
    ];
    // First verify its formed as a valid CIDR (we won't check the mask range)
    this.verifyCidr(cidr, false);
    // must be a /30 range
    const splitCidr = cidr.split("/");
    if (parseInt(splitCidr[1]) != 30) {
      throw new Error(`VPN Tunnel inside CDIR ${cidr} must be a /30 range`);
    }
    // Must be in the 169.254 range
    if (!cidr.startsWith("169.254.")) {
      throw new Error(
        `VPN Tunnel inside CIDR ${cidr} must be within the 169.254.0.0/16 address space`,
      );
    }
    // Go over our reserved blocks and verify
    for (const reservedBlock of amazonReservedInsideCidrs) {
      if (cidr == reservedBlock) {
        throw new Error(
          `VPN Tunnel inside CIDR ${cidr} conflicts with Amazon reserved address space`,
        );
      }
    }
  }

  verifyCidrsVpcs() {
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      const configStanza = this.configRaw.vpcs[vpcName];
      this.verifyCidr(configStanza.vpcCidr);
    }
  }

  verifyVpcsSubnetOptions() {
    // /28 netmask and /16
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      const vpcConfigStanza = this.configRaw.vpcs[vpcName];
      for (const subnetName of Object.keys(vpcConfigStanza.subnets)) {
        const subnetStanza = vpcConfigStanza.subnets[subnetName];
        if (subnetStanza.cidrMask < 16 || subnetStanza.cidrMask > 28) {
          throw new Error(
            `A Subnet cidrMask of ${subnetStanza.cidrMask} was given.  Valid values are between 16 and 28`,
          );
        }
        if (subnetStanza.sharedWith) {
          let sharedWith: number | string;
          for (sharedWith of subnetStanza.sharedWith) {
            this.verifySubnetSharedWith(sharedWith, subnetName);
          }
        }
      }
    }
  }

  verifySubnetSharedWith(sharedWith: string | number, subnetName: string) {
    if (isNaN(<number>sharedWith)) {
      // String value - Verify our startswith starts with an 'o-' entire organization or a 'ou-' specific ou.
      const startsWithString = sharedWith.toString();
      if (
        !startsWithString.startsWith("o-") &&
        !startsWithString.startsWith("ou-")
      ) {
        throw new Error(
          `Subnet ${subnetName} sharedWith must start with an o- (entire organization) or ou- (an ou within an organization)`,
        );
      }
      // Where it's shared with an ou- we need to know our organizationId
      if (startsWithString.startsWith("ou-")) {
        // Share with an OU.  Verify we have our global attribute prsent and they both start with
        if (this.configRaw.global.organizationId) {
          if (!this.configRaw.global.organizationId.startsWith("o-")) {
            throw new Error(
              `Global option organizationId should begin with 'o-'.  Get the correct value from the organizational root account in the organizations page`,
            );
          }
        } else {
          throw new Error(
            `When sharing with an OU, Global option 'organizationId' must be present and set to the Organization ID (begins with o- from the Organizations service page)`,
          );
        }
        // Share with an OU.  Verify we have our global organization ID present and it is 12 digits
        if (this.configRaw.global.organizationMainAccountId) {
          if (this.configRaw.global.organizationMainAccountId.length != 12) {
            throw new Error(
              `Global option organizationMainAccountId must be a 12 digit AWS Account identifier.  Use the ID of the account owning the Organization.`,
            );
          }
        } else {
          throw new Error(
            `When sharing with an OU, Global option 'organizationMainAccountId' must be present and set to the AWS Account ID that owns the organization`,
          );
        }
      }
    } else {
      // Direct share with an AWS Account ID.  Assure it is 12 digits
      if (sharedWith.toString().length != 12) {
        throw new Error(
          `Subnet ${subnetName} has sharedWith set to ${sharedWith}.  AWS Account IDs must be 12 digits long`,
        );
      }
    }
  }

  verifyVpcWithNoTransitHasNoRoutes() {
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      const vpcConfigStanza = this.configRaw.vpcs[vpcName];
      if (vpcConfigStanza.hasOwnProperty("attachTgw")) {
        if (!vpcConfigStanza.attachTgw) {
          if (this.tgwHasRouteForVpc(vpcName)) {
            throw new Error(
              `VPC ${vpcName} is set to attachTgw:false but contains a route in the transitGateway section`,
            );
          }
        }
      }
    }
  }

  tgwHasRouteForVpc(name: string) {
    if (this.configRaw.hasOwnProperty("transitGateways")) {
      for (const transitGatewayName of Object.keys(
        this.configRaw.transitGateways,
      )) {
        const configStanza = this.configRaw.transitGateways[transitGatewayName];
        if (configStanza.blackholeRoutes) {
          for (const route of configStanza.blackholeRoutes) {
            if (route.vpcName == name) {
              return true;
            }
          }
        }
        if (configStanza.staticRoutes) {
          for (const route of configStanza.staticRoutes) {
            if (route.vpcName == name) {
              return true;
            }
            if (route.routesTo == name) {
              return true;
            }
          }
        }
        if (configStanza.dynamicRoutes) {
          for (const route of configStanza.dynamicRoutes) {
            if (route.vpcName == name) {
              return true;
            }
            if (route.routesTo == name) {
              return true;
            }
          }
        }
        if (configStanza.defaultRoutes) {
          for (const route of configStanza.defaultRoutes) {
            if (route.vpcName == name) {
              return true;
            }
            if (route.routesTo == name) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  providerNameExists(
    checkProviderName: string,
    onlyFirewalls: boolean = false,
  ) {
    for (const providerType of ["endpoints", "internet", "firewall"]) {
      if (this.configRaw.hasOwnProperty("providers")) {
        if (this.configRaw.providers.hasOwnProperty(providerType)) {
          for (const providerName of Object.keys(
            this.configRaw.providers[providerType],
          )) {
            if (providerName == checkProviderName) {
              // Match
              if (onlyFirewalls) {
                if (providerType == "firewall") {
                  return true;
                }
              } else {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }

  allProviderNames(): Array<string> {
    const providerNames: Array<string> = [];
    for (const providerType of ["endpoints", "internet", "firewall"]) {
      if (this.configRaw.hasOwnProperty("providers")) {
        if (this.configRaw.providers.hasOwnProperty(providerType)) {
          for (const providerName of Object.keys(
            this.configRaw.providers[providerType],
          )) {
            providerNames.push(providerName);
          }
        }
      }
    }
    return providerNames;
  }

  vpcNameExists(checkVpcName: string) {
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      if (vpcName == checkVpcName) {
        return true;
      }
    }
    return false;
  }

  // Update as needed as more resources are supported
  allResourceNames(): Array<string> {
    return [
      ...this.allVpcNames(),
      ...this.allVpnNames(),
      ...this.allProviderNames(),
      ...this.allDxGwNames(),
    ];
  }

  allVpcNames(): Array<string> {
    const vpcNames: Array<string> = [];
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      vpcNames.push(vpcName);
    }
    return vpcNames;
  }

  vpnNameExists(checkVpnName: string) {
    if (this.configRaw.vpns) {
      for (const vpnName of Object.keys(this.configRaw.vpns)) {
        if (vpnName == checkVpnName) {
          return true;
        }
      }
    }
    return false;
  }

  allVpnNames(): Array<string> {
    const vpnNames: Array<string> = [];
    if (this.configRaw.vpns) {
      for (const vpnName of Object.keys(this.configRaw.vpns)) {
        vpnNames.push(vpnName);
      }
    }
    return vpnNames;
  }

  dxgwNameExists(checkDxGwName: string) {
    if (this.configRaw.dxgws) {
      for (const dxgwName of Object.keys(this.configRaw.dxgws)) {
        if (dxgwName == checkDxGwName) {
          return true;
        }
      }
    }
    return false;
  }

  allDxGwNames(): Array<string> {
    const dxGwNames: Array<string> = [];
    if (this.configRaw.dxgws) {
      for (const dxgwName of Object.keys(this.configRaw.dxgws)) {
        dxGwNames.push(dxgwName);
      }
    }
    return dxGwNames;
  }

  verifyResourceNamesUnique() {
    // Find all our names in our config file.
    const allNames = this.allResourceNames();
    // Our resulting array should not have any duplicate members
    const countOccurrences = (arr: Array<string>, val: string) =>
      arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
    const uniqueList = new Set(allNames);
    uniqueList.forEach((uniqueName) => {
      if (countOccurrences(allNames, uniqueName) > 1) {
        throw new Error(
          `Providers, VPNs, VPCs, and DxGws must be named uniquely within the config file.  Duplicate name ${uniqueName} was found`,
        );
      }
    });
  }

  // VPN can be imported, with existing customer gateway or without.
  vpnAssureRequiredArguments() {
    for (const vpnName of Object.keys(this.configRaw.vpns)) {
      const configStanza = this.configRaw.vpns[vpnName];
      // Import scenario first, then we'll default to non-import
      if (
        configStanza.existingVpnConnectionId ||
        configStanza.existingVpnTransitGatewayAttachId ||
        configStanza.existingVpnTransitGatewayRouteTableId
      ) {
        if (
          !configStanza.existingVpnConnectionId ||
          !configStanza.existingVpnConnectionId.startsWith("vpn-")
        ) {
          throw new Error(
            `Vpn: ${vpnName}: Importing an existing VPN requires 'existingVpnConnectionId' that starts with 'vpn-'`,
          );
        }
        if (
          !configStanza.existingVpnTransitGatewayAttachId ||
          !configStanza.existingVpnTransitGatewayAttachId.startsWith(
            "tgw-attach-",
          )
        ) {
          throw new Error(
            `Vpn: ${vpnName}: Importing an existing VPN requires 'existingVpnTransitGatewayAttachId' that starts with 'tgw-attach-'`,
          );
        }
        if (
          !configStanza.existingVpnTransitGatewayRouteTableId ||
          !configStanza.existingVpnTransitGatewayRouteTableId.startsWith(
            "tgw-rtb-",
          )
        ) {
          throw new Error(
            `Vpn: ${vpnName}: Importing an existing VPN requires 'existingVpnTransitGatewayRouteTableId' that starts with 'tgw-rtb-'`,
          );
        }
      } else {
        // Non Import scenario
        if (configStanza.existingCustomerGatewayId) {
          if (!configStanza.existingCustomerGatewayId.startsWith("cgw-")) {
            throw new Error(
              `Vpn: ${vpnName}: existing customer gateway IDs should start with cgw-`,
            );
          }
          if (
            configStanza.newCustomerGatewayIp ||
            configStanza.newCustomerGatewayAsn ||
            configStanza.newCustomerGatewayName
          ) {
            throw new Error(
              `Vpn: ${vpnName}: existingCustomerGatewayId which uses an existing gateway.  Do not specify any new* parameters as well`,
            );
          }
        } else {
          if (
            !configStanza.newCustomerGatewayIp ||
            !configStanza.newCustomerGatewayAsn ||
            !configStanza.newCustomerGatewayName
          ) {
            throw new Error(
              `Vpn: ${vpnName}: for new gateways, newCustomerGatewayIp, newCustomerGatewayAsn and newCustomerGatewayName must be specified`,
            );
          }
          if (!IPCidr.isValidAddress(configStanza.newCustomerGatewayIp)) {
            throw new Error(
              `Vpn: ${vpnName}: provided new customer gateway IP of ${configStanza.newCustomerGatewayIp} is not a valid IP`,
            );
          }
        }
        if (configStanza.tunnelOneOptions) {
          this.verifyTunnelInsideCidrs(
            configStanza.tunnelOneOptions.tunnelInsideCidr,
          );
        }
        if (configStanza.tunnelTwoOptions) {
          this.verifyTunnelInsideCidrs(
            configStanza.tunnelTwoOptions.tunnelInsideCidr,
          );
        }
      }
    }
  }

  // Direct Connect Gateway is always imported.  Assure expected format exists for our values.
  dxGwAssureRequiredArguments() {
    for (const dxGwName of Object.keys(this.configRaw.dxgws)) {
      const configStanza = this.configRaw.dxgws[dxGwName];
      if (!configStanza.existingTgwId.startsWith("tgw-")) {
        throw new Error(
          `DxGw: ${dxGwName}: Existing Transit Gateway 'existingTgwId' must begin with tgw-`,
        );
      }
      if (
        !configStanza.existingDxGwTransitGatewayAttachId.startsWith(
          "tgw-attach-",
        )
      ) {
        throw new Error(
          `DxGw: ${dxGwName}: Transit Gateway Attachment Value 'existingDxGwTransitGatewayAttachId' must begin with tgw-attach-`,
        );
      }
      if (
        !configStanza.existingDxGwTransitGatewayRouteTableId.startsWith(
          "tgw-rtb-",
        )
      ) {
        throw new Error(
          `DxGw: ${dxGwName}: Transit Gateway Route Table Value 'existingDxGwTransitGatewayRouteTableId' must begin with tgw-rtb-`,
        );
      }
    }
  }

  dnsVerifyRequiredArguments() {
    for (const dnsConfigName of Object.keys(this.configRaw.dns)) {
      const configStanza = this.configRaw.dns[dnsConfigName];
      // Must have a VPC either shared, or within template
      if (!configStanza.shareWithVpcs && !configStanza.shareWithExistingVpcs) {
        throw new Error(
          `DNS: ${dnsConfigName}: Private hosted zone must be associated with at least one VPC.  'shareWithVpcs' and/or 'shareWithExistingVpcs' are required`,
        );
      }
      // If shareWithVpcs assure we can resolve those names in the configuration file.
      if (configStanza.shareWithVpcs) {
        for (const sharedWithVpc of configStanza.shareWithVpcs) {
          if (
            !this.vpcNameExists(sharedWithVpc) &&
            !this.providerNameExists(sharedWithVpc)
          ) {
            throw new Error(
              `DNS: ${dnsConfigName}: contains sharedWithVpc value of ${sharedWithVpc}.  Unable to find ${sharedWithVpc} as a VPC or Provider in the configuration.`,
            );
          }
        }
      }
      // If shareWithExistingVpcs is set, assure the vpcId starts with vpc-
      if (configStanza.shareWithExistingVpcs) {
        for (const shareWithExistingVpc of configStanza.shareWithExistingVpcs) {
          if (!shareWithExistingVpc.vpcId.startsWith("vpc-")) {
            throw new Error(
              `DNS: ${dnsConfigName}: contains shareWithExistingVpc with vpc ID ${shareWithExistingVpc.vpcId}.  This value must start with 'vpc-'`,
            );
          }
          const regionSplit = shareWithExistingVpc.vpcRegion.split("-");
          if (regionSplit.length != 3) {
            throw new Error(
              `DNS ${dnsConfigName}: Contains shareWithExistingVpc with region ${shareWithExistingVpc.vpcRegion}.  This does not appear valid.  Use format ie: us-east-1`,
            );
          }
        }
      }
      // Assure our domain contains some dots.  We won't do the full regex here.  CloudFormation will catch that if needed.
      for (const domain of configStanza.domains) {
        if (domain.split(".").length < 2) {
          throw new Error(
            `DNS: ${dnsConfigName}: Contains a domain ${domain}.  Does not appear to be a valid domain.  Should contain at least one .`,
          );
        }
      }
    }
  }

  // route vpcName points to a vpc
  // route routesTo points to a valid resource in the config file
  twgRouteNamesValid(configStanza: any) {
    const routeTypes = [
      "blackholeRoutes",
      "staticRoutes",
      "dynamicRoutes",
      "defaultRoutes",
    ];
    const routeHuman: Record<string, string> = {
      blackholeRoutes: "blackhole route",
      staticRoutes: "static route",
      dynamicRoutes: "dynamic route",
      defaultRoutes: "default route",
    };
    const allNames = this.allResourceNames();

    routeTypes.forEach((routeType) => {
      if (configStanza[routeType]) {
        for (const route of configStanza[routeType]) {
          // vpcName points to a vpc
          if (!this.vpcNameExists(route.vpcName)) {
            if (allNames.includes(route.vpcName)) {
              // If vpcName points to a non-vpc provide a more useful message
              throw new Error(
                `Invalid vpcName specified for ${routeHuman[routeType]}.  'vpcName: ${route.vpcName}'. A non-VPC resource is using this name.`,
              );
            } else {
              throw new Error(
                `A ${routeHuman[routeType]} was specified for ${route.vpcName} - vpc with that name could not be found`,
              );
            }
          }
          // routesTo points to a valid resource in the config.  Not applicable for BlackholeRoutes
          if (routeType != "blackholeRoutes") {
            if (!allNames.includes(route.routesTo)) {
              throw new Error(
                `A ${routeHuman[routeType]} for VPC Named ${route.vpcName} to route to ${route.routesTo}.  Configuration file does not contain a resource named ${route.routesTo}`,
              );
            }
          }
        }
      }
    });
  }

  // Where present, inspectedBy routes a valid
  // Dynamic route inspectedBy where routesTo is a VPN is not supported
  twgRouteInspectedByValid(configStanza: any) {
    const routeTypes = ["staticRoutes", "dynamicRoutes", "defaultRoutes"];
    const routeHuman: Record<string, string> = {
      staticRoutes: "static route",
      dynamicRoutes: "dynamic route",
      defaultRoutes: "default route",
    };

    routeTypes.forEach((routeType) => {
      if (configStanza[routeType]) {
        for (const route of configStanza[routeType]) {
          if (route.inspectedBy) {
            if (!this.providerNameExists(route.inspectedBy, true)) {
              throw new Error(
                `A ${routeHuman[routeType]} is set to be inspected by ${route.inspectedBy} but no firewall provider with that name was found`,
              );
            }
            // Dynamic routes where routeTo is a VPN are not supported
            if (routeType == "dynamicRoutes") {
              if (this.vpnNameExists(route.routesTo)) {
                throw new Error(
                  `VPN as the 'routesTo' destination with inspection is not possible using Dynamic Routing.  Implement via Static or Default Route instead.`,
                );
              }
            }
          }
        }
      }
    });
  }

  tgwRouteChecks() {
    if (this.configRaw.hasOwnProperty("transitGateways")) {
      for (const transitGatewayName of Object.keys(
        this.configRaw.transitGateways,
      )) {
        const configStanza = this.configRaw.transitGateways[transitGatewayName];
        // vpcName is a VPC.  routesTo is valid.  For all Route Types
        this.twgRouteNamesValid(configStanza);
        // InspectedBy - if configured for static, dynamic, default points to a valid firewall
        this.twgRouteInspectedByValid(configStanza);
      }
    }
  }

  // within the structure of [ vpcName: string, routesTo: string ] only vpcNames may be present
  // BlackHole routes may only be specified for vpcs
  // Verify that our references are valid for routesTo, inspectedBy
  // tgwRoutesAreSane() {
  //     if (this.configRaw.hasOwnProperty("transitGateways")) {
  //         for (const transitGatewayName of Object.keys(
  //             this.configRaw.transitGateways,
  //         )) {
  //             const configStanza = this.configRaw.transitGateways[transitGatewayName];
  //             const allNames: Array<string> = [
  //                 ...this.allVpcNames(),
  //                 ...this.allVpnNames(),
  //                 ...this.allProviderNames(),
  //                 ...this.allDxGwNames()
  //             ]
  //             // BlackHole routes may only be specified for vpcs
  //             if (configStanza.blackholeRoutes) {
  //                 for (const route of configStanza.blackholeRoutes) {
  //                     if (!this.vpcNameExists(route.vpcName)) {
  //                         if (allNames.includes(route.vpcName)) {
  //                             throw new Error(
  //                                 `Invalid vpcName specified for blackhole route.  'vpcName: ${route.vpcName}'. A non-VPC resource has this name.`
  //                             )
  //                         } else {
  //                             throw new Error(
  //                                 `A blackhole route was specified for ${route.vpcName} - vpc with that name could be found`,
  //                             );
  //                         }
  //                     }
  //                 }
  //             }
  //             // vpcName entry must be a vpc
  //             // If inspectedBy is specified we must have a firewall definition
  //             if (configStanza.staticRoutes) {
  //                 for (const route of configStanza.staticRoutes) {
  //                     // Static route must be a vpcName
  //                     if (!this.vpcNameExists(route.vpcName)) {
  //                         if (allNames.includes(route.vpcName)) {
  //                             throw new Error(
  //                                 `Invalid vpcName specified for static route.  'vpcName: ${route.vpcName}'. A non-VPC resource has this name.`
  //                             )
  //                         } else {
  //                             throw new Error(
  //                                 `A static route was specified for ${route.vpcName} - vpc with that name could be found`,
  //                             );
  //                         }
  //                     }
  //                     // We must have a firewall provider by this name
  //                     if (route.inspectedBy) {
  //                         if (!this.providerNameExists(route.inspectedBy, true)) {
  //                             throw new Error(
  //                                 `A static route is set to be inspected by ${route.inspectedBy} but no firewall provider with that name was found`,
  //                             );
  //                         }
  //                     }
  //                 }
  //             }
  //             // vpcName entry must be a vpc
  //             // routesTo must be a valid resource name
  //             // If inspectedBy is specified we must have a firewall definition
  //             // routesTo cannot be a VPN if inspectedBy is present
  //             if (configStanza.dynamicRoutes) {
  //                 for (const route of configStanza.dynamicRoutes) {
  //                     if (!this.vpcNameExists(route.vpcName)) {
  //                         if (allNames.includes(route.vpcName)) {
  //                             throw new Error(
  //                                 `Invalid vpcName specified for dynamic route.  'vpcName: ${route.vpcName}'. A non-VPC resource has this name.`
  //                             )
  //                         } else {
  //                             throw new Error(
  //                                 `A dynamic route was specified for ${route.vpcName} - vpc with that name could be found`,
  //                             );
  //                         }
  //                     }
  //                     if (route.inspectedBy) {
  //                         if (!this.providerNameExists(route.inspectedBy, true)) {
  //                             throw new Error(
  //                                 `A dynamic route is set to be inspected by ${route.inspectedBy} but no firewall provider with that name was found`,
  //                             );
  //                         }
  //                         if (this.vpnNameExists(route.routesTo)) {
  //                             throw new Error(
  //                                 `VPN as the 'routesTo' destination with inspection is not possible using Dynamic Routing.  Implement via Static or Default Route instead.`,
  //                             );
  //                         }
  //                     }
  //                 }
  //             }
  //             // vpcName entry must be a vpc
  //             // If inspectedBy is specified we must have a firewall definition
  //             if (configStanza.defaultRoutes) {
  //                 for (const route of configStanza.defaultRoutes) {
  //                     if (!this.vpcNameExists(route.vpcName)) {
  //                         if (allNames.includes(route.vpcName)) {
  //                             throw new Error(
  //                                 `Invalid vpcName specified for default route.  'vpcName: ${route.vpcName}'. A non-VPC resource has this name.`
  //                             )
  //                         } else {
  //                             throw new Error(
  //                                 `A default route was specified for ${route.vpcName} - vpc with that name could be found`,
  //                             );
  //                         }
  //                     }
  //                     if (route.inspectedBy) {
  //                         if (!this.providerNameExists(route.inspectedBy, true)) {
  //                             throw new Error(
  //                                 `A default route is set to be inspected by ${route.inspectedBy} but no firewall provider with that name was found`,
  //                             );
  //                         }
  //                     }
  //                 }
  //             }
  //         }
  //     }
  // }

  verifyVpcProvidersExist() {
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      const vpcConfigStanza = this.configRaw.vpcs[vpcName];
      if (vpcConfigStanza.hasOwnProperty("providerEndpoints")) {
        this.locateProviderByName(
          vpcConfigStanza.providerEndpoints,
          "endpoints",
          vpcName,
        );
      }
      if (vpcConfigStanza.hasOwnProperty("providerInternet")) {
        this.locateProviderByName(
          vpcConfigStanza.providerInternet,
          "internet",
          vpcName,
        );
      }
    }
  }

  // Confirms that if a vpc has an internet based route, that it also contains a 'providerInternet' statement.
  // This is a 'verification' check versus a technical check to assure that providing internet access was intentional
  verifyInternetProviderRoutes() {
    if (
      this.configRaw.hasOwnProperty("providers") &&
      this.configRaw["providers"].hasOwnProperty("internet")
    ) {
      for (const internetProviderName of Object.keys(
        this.configRaw["providers"]["internet"],
      )) {
        this.locateRouteByName(
          undefined,
          internetProviderName,
          undefined,
        ).forEach((route) => {
          const vpcStanza = this.locateVpcStanzaByName(route.vpcName);
          if (
            vpcStanza != undefined &&
            !vpcStanza.hasOwnProperty("providerInternet")
          ) {
            throw new Error(
              `Vpc: ${route.vpcName} has a route to internet provider ${internetProviderName} but does not have 'providerInternet' defined in the vpc configuration.`,
            );
          }
        });
      }
    }
  }

  // Returns a route given the vpcName, routesTo, or inspectBy name
  locateRouteByName(vpcName?: string, routesTo?: string, inspectedBy?: string) {
    const matchingRoutes: Array<any> = [];
    if (this.configRaw.hasOwnProperty("transitGateways")) {
      for (const transitGatewayName of Object.keys(
        this.configRaw.transitGateways,
      )) {
        const configStanza = this.configRaw.transitGateways[transitGatewayName];
        for (const routeStyle of [
          "defaultRoutes",
          "staticRoutes",
          "dynamicRoutes",
        ])
          if (configStanza[routeStyle]) {
            for (const route of configStanza[routeStyle]) {
              if (vpcName && routesTo && inspectedBy) {
                if (
                  route.vpcName == vpcName &&
                  route.routesTo == routesTo &&
                  route.inspectedBy == inspectedBy
                ) {
                  matchingRoutes.push(route);
                }
              }
              if (vpcName && routesTo) {
                if (route.vpcName == vpcName && route.routesTo == routesTo) {
                  matchingRoutes.push(route);
                }
              }
              if (routesTo) {
                if (route.routesTo == routesTo) {
                  matchingRoutes.push(route);
                }
              }
              if (vpcName) {
                if (route.vpcName == vpcName) {
                  matchingRoutes.push(route);
                }
              }
            }
          }
      }
    }
    return matchingRoutes;
  }

  locateVpcStanzaByName(vpcNameFind: string): any | undefined {
    for (const vpcName of Object.keys(this.configRaw.vpcs)) {
      if (vpcName == vpcNameFind) {
        return this.configRaw.vpcs[vpcName];
      }
    }
    return undefined;
  }

  // Errors are contextual to verifyVpcProvidersExist
  locateProviderByName(
    providerName: string,
    providerType: string,
    vpcStanzaEvaluating: string,
  ) {
    if (this.configRaw.hasOwnProperty("providers")) {
      if (this.configRaw.providers.hasOwnProperty(providerType)) {
        if (
          !this.configRaw.providers[providerType].hasOwnProperty(providerName)
        ) {
          throw new Error(
            `VPC ${vpcStanzaEvaluating} specifies ${providerType} provider named ${providerName}.  No provider with that name was found`,
          );
        }
      } else {
        throw new Error(
          `VPC ${vpcStanzaEvaluating} specifies a ${providerType} provider.  However no provider of type ${providerType} was found`,
        );
      }
    } else {
      throw new Error(
        `VPC ${vpcStanzaEvaluating} specifies a ${providerType} provider.  However no providers are defined.`,
      );
    }
  }

  // Determines if the string value passed for blackholeCidr is in a CIDR Format
  blackholeIsCidr(cidr: string): boolean {
    return IPCidr.isValidCIDR(cidr);
  }

  verifyCidr(cidr: string, checkMaskRange: boolean = true) {
    try {
      new IPCidr(cidr);
    } catch (e) {
      throw new Error(`CIDR Address provided ${cidr} is not valid.`);
    }

    const cidrSplit = cidr.split("/");
    if (checkMaskRange) {
      const mask = parseInt(cidrSplit[1]);
      if (mask < 16 || mask > 28) {
        throw new Error(
          `CIDR Address Mask ${cidr} mask must be between /16 and /28 for a Vpc`,
        );
      }
    }

    const cidrClass = new IPCidr(cidr);

    if (cidrClass.start() != cidrSplit[0]) {
      throw new Error(
        `CIDR Address provided ${cidr} should start at address ${cidrClass.start()}.  Re-format.`,
      );
    }
  }

  verifySsmPrefix() {
    if (!this.configRaw.global.ssmPrefix.startsWith("/")) {
      throw new Error(`Global section - ssmPrefix must begin with a leading /`);
    }
    if (this.configRaw.global.ssmPrefix.endsWith("/")) {
      throw new Error(
        `Global section - ssmPrefix cannot end with a trailing /`,
      );
    }
  }

  verifyDiscoveryFolder() {
    if (this.configRaw.global.discoveryFolder) {
      if (!fs.existsSync(path.join(this.configRaw.global.discoveryFolder!))) {
        throw new Error(
          `Discovery folder specified by ${this.configRaw.global
            .discoveryFolder!} does not exist.`,
        );
      }
    }
  }

  // This is maybe a future capability but for now we will limit to just one until implemented and thought through.
  verifyOnlyOneTransitGateway() {
    if (this.configRaw.hasOwnProperty("transitGateways")) {
      if (Object.keys(this.configRaw.transitGateways).length > 1) {
        throw new Error(
          "At this moment, only one transit gateway is supported.  PR requests welcome!",
        );
      }
    }
  }

  verifyTransitGatewayOptions() {
    if (this.configRaw.hasOwnProperty("transitGateways")) {
      for (const tgwName of Object.keys(this.configRaw.transitGateways)) {
        if (this.configRaw.transitGateways[tgwName].useExistingTgwId) {
          if (
            !this.configRaw.transitGateways[
              tgwName
            ].useExistingTgwId.startsWith("tgw-")
          ) {
            throw new Error(
              `Transit Gateway: ${tgwName} importing using 'useExistingTgwId' must start with 'tgw-'`,
            );
          }
        }
      }
    }
  }

  verifyVpnsTransitExists() {
    const transitGatewayNames: Array<string> = [];
    for (const vpnName of Object.keys(this.configRaw.vpns)) {
      transitGatewayNames.push(this.configRaw.vpns[vpnName].useTransit);
    }
    for (const transitGatewayName of transitGatewayNames) {
      if (this.configRaw.hasOwnProperty("transitGateways")) {
        if (
          !this.configRaw.transitGateways.hasOwnProperty(transitGatewayName)
        ) {
          throw new Error(
            `Vpn has useTransit: ${transitGatewayName}.  However no 'transitGateways:' with that name found`,
          );
        }
      } else {
        throw new Error(
          `Use of VPN requires a transit gateway.  However transitGateway: was not defined.`,
        );
      }
    }
  }

  verifyProvidersTransitsExist() {
    const transitGatewayNames: Array<string> = [];
    for (const providerType of ["endpoints", "internet", "firewall"]) {
      if (this.configRaw.hasOwnProperty("providers")) {
        if (this.configRaw.providers.hasOwnProperty(providerType)) {
          for (const providerName of Object.keys(
            this.configRaw.providers[providerType],
          )) {
            const configStanza =
              this.configRaw.providers[providerType][providerName];
            transitGatewayNames.push(configStanza.useTransit);
          }
        }
      }
    }
    for (const transitGatewayName of transitGatewayNames) {
      if (this.configRaw.hasOwnProperty("transitGateways")) {
        if (
          !this.configRaw.transitGateways.hasOwnProperty(transitGatewayName)
        ) {
          throw new Error(
            `Provider has useTransit: ${transitGatewayName}.  However no 'transitGateways:' with that name found`,
          );
        }
      } else {
        throw new Error(
          `All providers require a transit gateway.  However transitGateway: was not defined.`,
        );
      }
    }
  }
}
