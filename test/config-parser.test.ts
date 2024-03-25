// import { Template } from '@aws-cdk/assertions';
// import * as cdk from '@aws-cdk/core';
// import * as VpcScratch from '../lib/vpc-scratch-stack';
import { IConfig } from "../lib/config/config-types";
import { ConfigParser } from "../lib/config/parser";

const minimumConfig = () => {
  const minimumConfig: IConfig = {
    global: {
      stackNamePrefix: "testing",
      ssmPrefix: "/infrastructure/network",
      region: "us-east-1",
      availabilityZones: ["us-east-1a", "us-east-1b"],
    },
    vpcs: {
      dev: {
        style: "workloadIsolated",
        vpcCidr: "10.4.0.0/16",
        subnets: {
          test: {
            cidrMask: 21,
          },
        },
      },
    },
  };
  // If we don't do this, any changes we make will propagate.  This assures a private copy for our caller
  return Object.assign(
    {},
    JSON.parse(JSON.stringify(minimumConfig))
  ) as IConfig;
};

test("MinimumSucceeds", () => {
  const configContents = minimumConfig();
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("InvalidCidr", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].vpcCidr = "10.1.2.0";
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.1.2.0 is not valid."
  );
});

test("InvalidCidrMask", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].vpcCidr = "10.1.2.0/32";
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address Mask 10.1.2.0/32 mask must be between /16 and /28 for a Vpc"
  );
  configContents.vpcs["dev"].vpcCidr = "10.1.2.0/15";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address Mask 10.1.2.0/15 mask must be between /16 and /28 for a Vpc"
  );
});

test("InvalidSubnetCidr", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].subnets["test"].cidrMask = 31;
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "A Subnet cidrMask of 31 was given.  Valid values are between 16 and 28"
  );
  configContents.vpcs["dev"].subnets["test"].cidrMask = 8;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "A Subnet cidrMask of 8 was given.  Valid values are between 16 and 28"
  );
});

test("OrganizationSharingOptions", () => {
  const configContents = minimumConfig();
  // AWS Account ID not long enough
  configContents.vpcs["dev"].subnets["test"].sharedWith = [1234567];
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Subnet test has sharedWith set to 1234567.  AWS Account IDs must be 12 digits long"
  );
  // Shared with an OU but not formatted correctly
  configContents.vpcs["dev"].subnets["test"].sharedWith = ["oa-12341"];
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Subnet test sharedWith must start with an o- (entire organization) or ou- (an ou within an organization)"
  );
  // Shared with has an ou formatted correctly but missing organizationId in global
  configContents.vpcs["dev"].subnets["test"].sharedWith = ["ou-12341"];
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "When sharing with an OU, Global option 'organizationId' must be present and set to the Organization ID (begins with o- from the Organizations service page)"
  );
  // Shared with has an ou formatted correctly organizationId in global but not formed correctly
  configContents.vpcs["dev"].subnets["test"].sharedWith = ["ou-12341"];
  configContents.global.organizationId = "testing";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Global option organizationId should begin with 'o-'.  Get the correct value from the organizational root account in the organizations page"
  );
});

test("CidrBadStartVpc", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].vpcCidr = "10.1.2.0/17";
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.1.2.0/17 should start at address 10.1.0.0.  Re-format."
  );
});

test("CidrBadStartProviders", () => {
  const configContents = minimumConfig();
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  // Internet
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.2.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.1.2.0/17 should start at address 10.1.0.0.  Re-format."
  );
  // Firewall
  configContents.providers = {
    firewall: {
      testing: {
        vpcCidr: "10.1.2.0/17",
        style: "awsNetworkFirewall",
        useTransit: "testing",
        firewallName: "testing",
        firewallDescription: "testing",
      },
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.1.2.0/17 should start at address 10.1.0.0.  Re-format."
  );
  // Endpoints
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.2.0/17",
        style: "serviceInterfaceEndpoint",
        useTransit: "testing",
        endpointConfigFile: "sample-complex-endpoints",
      },
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.1.2.0/17 should start at address 10.1.0.0.  Re-format."
  );
});

test("InvalidRegion", () => {
  const configContents = minimumConfig();
  configContents.global.region = "us-esat-2";
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "Global section - region us-esat-2 is not a valid Region name"
  );
})

test("BadDiscoveryFolder", () => {
  const configContents = minimumConfig();
  configContents.global.discoveryFolder = "hopefully-does-not-exist";
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Discovery folder specified by hopefully-does-not-exist does not exist."
  );
});

test("OnlyOneTransitGateway", () => {
  const configContents = minimumConfig();
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
    testing2: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "At this moment, only one transit gateway is supported.  PR requests welcome!"
  );
});

test("TransitViaImportSucceeds", () => {
  const configContents = minimumConfig();
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
      useExistingTgwId: "tgw-12345",
    },
  };
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("TransitViaImportBadTgwSucceeds", () => {
  // "Transit Gateway: ${tgwName} importing using 'useExistingTgwId' must start with 'tgw-'"
  const configContents = minimumConfig();
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
      useExistingTgwId: "tagw-12345",
    },
  };
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Transit Gateway: testing importing using 'useExistingTgwId' must start with 'tgw-'"
  );
});

test("TransitMustExistForProviders", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.2.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  // Not adding Tranits although we have a useTransit
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "All providers require a transit gateway.  However transitGateway: was not defined."
  );
});

test("TranitsMustExistForProviders", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.2.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  configContents.transitGateways = {
    different: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  // Transit exists, however it is not the same name as needed by provider
  const config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Provider has useTransit: testing.  However no 'transitGateways:' with that name found"
  );
});

test("VpcWantsProviderButProviderNotPresent", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].providerInternet = "testing";
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies a internet provider.  However no providers are defined."
  );
  delete configContents.vpcs["dev"].providerInternet;
  configContents.vpcs["dev"].providerEndpoints = "testing";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies a endpoints provider.  However no providers are defined."
  );
});

test("VpcWantsProviderButTypeNotPresent", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].providerEndpoints = "testing";
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies a endpoints provider.  However no provider of type endpoints was found"
  );
  delete configContents.vpcs["dev"].providerEndpoints;
  delete configContents.providers.internet;
  configContents.vpcs["dev"].providerInternet = "testing";
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "serviceInterfaceEndpoint",
        useTransit: "testing",
        endpointConfigFile: "sample-complex-endpoints",
      },
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies a internet provider.  However no provider of type internet was found"
  );
});

test("VpcWantsProviderButNameNotPresent", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].providerEndpoints = "different";
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "serviceInterfaceEndpoint",
        useTransit: "testing",
        endpointConfigFile: "sample-complex-endpoints",
      },
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies endpoints provider named different.  No provider with that name was found"
  );
  delete configContents.vpcs["dev"].providerEndpoints;
  delete configContents.providers.internet;
  configContents.vpcs["dev"].providerInternet = "different";
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev specifies internet provider named different.  No provider with that name was found"
  );
});

test("VpcMarkedNotToAttachHasTgwRoute", () => {
  const configContents = minimumConfig();
  configContents.vpcs["dev"].attachTgw = false;
  configContents.vpcs["dev"].providerInternet = "testing";
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
      dynamicRoutes: [
        {
          vpcName: "dev",
          routesTo: "testing",
        },
      ],
    },
  };
  // Dyanmic Route entry
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev is set to attachTgw:false but contains a route in the transitGateway section"
  );
  delete configContents.transitGateways["testing"].dynamicRoutes;
  configContents.transitGateways["testing"].staticRoutes = [
    {
      vpcName: "dev",
      staticCidr: "10.1.10.0/24",
      routesTo: "testing",
    },
  ];
  // Static Route Entry
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev is set to attachTgw:false but contains a route in the transitGateway section"
  );
  delete configContents.transitGateways["testing"].staticRoutes;
  configContents.transitGateways["testing"].blackholeRoutes = [
    {
      vpcName: "dev",
      blackholeCidrs: ["10.1.10.0/25"],
    },
  ];
  // Blackhole routes
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev is set to attachTgw:false but contains a route in the transitGateway section"
  );
  delete configContents.transitGateways["testing"].blackholeRoutes;
  configContents.transitGateways["testing"].defaultRoutes = [
    {
      vpcName: "dev",
      routesTo: "testing",
    },
  ];
  // Default routes
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "VPC dev is set to attachTgw:false but contains a route in the transitGateway section"
  );
});

test("DuplicateResourceNamesUsed", () => {
  const configContents = minimumConfig();
  // dev provider has same name as the dev vpc
  configContents.providers = {
    internet: {
      dev: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing"
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "Providers, VPNs, VPCs, TGW Peers, and DxGws must be named uniquely within the config file.  Duplicate name dev was found"
  );
  delete configContents.providers;
  // // dev vpn has same name as the dev vpc
  configContents.vpns = {
    dev: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "Providers, VPNs, VPCs, TGW Peers, and DxGws must be named uniquely within the config file.  Duplicate name dev was found"
  );
  delete configContents.vpns
  // // dev dxgw has same name as the dev vpc
  configContents.dxgws = {
    dev: {
      existingDxGwTransitGatewayAttachId: "tgwattach-1234",
      existingDxGwTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingTgwId: "tgw-1234",
    },
  }
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "Providers, VPNs, VPCs, TGW Peers, and DxGws must be named uniquely within the config file.  Duplicate name dev was found"
  );
  delete configContents.dxgws
  // dev tgwPeer has same name as the dev vpc
  configContents.tgwPeers = {
    dev: {
      existingTgwPeerTransitGatewayAttachId: "tgwattach-1234",
      existingTgwPeerTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingTgwId: "tgw-1234",
    }
  }
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "Providers, VPNs, VPCs, TGW Peers, and DxGws must be named uniquely within the config file.  Duplicate name dev was found"
  );
});

// vpcName points to a vpc
// routesTo points to a valid resource
// inspectedBy when configured is a firewall device
// where routesTo is a VPN and inspectBy is configured we redirect to static or dynamic routes
test("RouteNamingSanity", () => {
  const routeTypes = [ "blackholeRoutes", "staticRoutes", "dynamicRoutes", "defaultRoutes" ]

  const routeHuman: Record<string, string> = {
    blackholeRoutes: "blackhole route",
    staticRoutes: "static route",
    dynamicRoutes: "dynamic route",
    defaultRoutes: "default route"
  }
  const configContents: any = minimumConfig();
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
    firewall: {
      testingFirewall: {
        vpcCidr: "10.1.0.0/17",
        style: "awsNetworkFirewall",
        useTransit: "testing",
        firewallName: "testing",
        firewallDescription: "testing",
      },
    },
  };
  configContents.vpcs["dev"].providerInternet = "testing";
  configContents.dxgws = {
    todc: {
      existingDxGwTransitGatewayAttachId: "tgw-attach-1234",
      existingDxGwTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingTgwId: "tgw-1234",
    },
  }
  configContents.tgwPeers = {
    "region2": {
      existingTgwPeerTransitGatewayAttachId: "tgw-attach-678910",
      existingTgwPeerTransitGatewayRouteTableId: "tgw-rtb-678910",
      existingTgwId: "tgw-678910",
    }
  }
  configContents.vpns = {
    devvpn: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  routeTypes.forEach((routeType) => {
    if(routeType == "blackholeRoutes") {
      configContents.transitGateways["testing"][routeType] = [
        {
          vpcName: "testing2",
          blackholeCidrs: [ "10.1.0.0/16" ],
        },
      ]
    }
    if(routeType == "dynamicRoutes" || routeType == "defaultRoutes") {
      configContents.transitGateways["testing"][routeType] = [
        {
          vpcName: "testing2",
          routesTo: "dev",
        },
      ]
    }
    if(routeType == "staticRoutes") {
      configContents.transitGateways["testing"][routeType] = [
        {
          vpcName: "testing2",
          routesTo: "dev",
          staticCidr: "10.1.0.0/16"
        },
      ]
    }
    // vpcName is not present for any resource
    let config = new ConfigParser({ configContents: configContents });
    expect(() => config.parse()).toThrow(
        `A ${routeHuman[routeType]} was specified for testing2 - vpc with that name could not be found`
    );
    // vpcName is a non-vpc resource
    configContents.transitGateways["testing"][routeType][0].vpcName = "todc"
    config = new ConfigParser({ configContents: configContents });
    expect(() => config.parse()).toThrow(
        `Invalid vpcName specified for ${routeHuman[routeType]}.  'vpcName: todc'. A non-VPC resource is using this name.`
    );
    if(routeType != "blackholeRoutes") {
      // routesTo is not present in config
      configContents.transitGateways["testing"][routeType][0].vpcName = "dev"
      configContents.transitGateways["testing"][routeType][0].routesTo = "testing2"
      config = new ConfigParser({ configContents: configContents });
      expect(() => config.parse()).toThrow(
          `A ${routeHuman[routeType]} for VPC Named dev to route to testing2.  Configuration file does not contain a resource named testing2`
      );
      // inspectBy Missing (although matches another provider).  InspectBy not valid for BlackHOle routes
      configContents.transitGateways["testing"][routeType][0].routesTo = "testing"
      configContents.transitGateways["testing"][routeType][0].inspectedBy = "testing"
      config = new ConfigParser({configContents: configContents});
      expect(() => config.parse()).toThrow(
          `A ${routeHuman[routeType]} is set to be inspected by testing but no firewall provider with that name was found`
      );
      // inspectBy routesTo VPN with dynamic routes
      // A Transit Gateway Peer routes to Dynamic
      if(routeType == "dynamicRoutes") {
        // Transit Gateway peer with dynamic route
        configContents.transitGateways["testing"][routeType][0].routesTo = "region2"
        config = new ConfigParser({configContents: configContents});
        expect(() => config.parse()).toThrow(
            "A Transit Gateway Peer as the 'routesTo' using Dynamic Routing is not supported.  Implement via Static or Default Route instead."
        );
        // inspectBy routesTo VPN with dynamic routes
        configContents.transitGateways["testing"][routeType][0].routesTo = "devvpn"
        configContents.transitGateways["testing"][routeType][0].inspectedBy = "testingFirewall"
        config = new ConfigParser({configContents: configContents});
        expect(() => config.parse()).toThrow(
            "VPN as the 'routesTo' destination with inspection is not possible using Dynamic Routing.  Implement via Static or Default Route instead."
        );
      }
    }
    // Clean out for our next route type tests
    delete configContents.transitGateways["testing"][routeType]
  })
});

test("BlackHoleCidrValue", () => {

  const configContents: any = minimumConfig();
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  // Invalid CIDR, invalid VPCName
  configContents.transitGateways["testing"]["blackholeRoutes"] = [
    {
      vpcName: "dev",
      blackholeCidrs: [ "10.1.0.0" ],
    },
  ]
    let config = new ConfigParser({ configContents: configContents });
    expect(() => config.parse()).toThrow(
        `blackholeRoutes contains blackholeCidr with value 10.1.0.0.  Not a valid CIDR Address or Vpc Name within the 'vpc:' configuration section.`
    );
});

test("RouteToInternetWithNoInternetProviderInVpc", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    internet: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "natEgress",
        useTransit: "testing",
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
      defaultRoutes: [
        {
          vpcName: "dev",
          routesTo: "testing",
        },
      ],
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpc: dev has a route to internet provider testing but does not have 'providerInternet' defined in the vpc configuration."
  );
});

test("DxGwImportValuesNotCorrect", () => {
  const configContents = minimumConfig();
  configContents.dxgws = {
    toDc: {
      existingDxGwTransitGatewayAttachId: "tgwattach-1234",
      existingDxGwTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingTgwId: "tgw-1234",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "DxGw: toDc: Transit Gateway Attachment Value 'existingDxGwTransitGatewayAttachId' must begin with tgw-attach-"
  );
  configContents.dxgws = {
    toDc: {
      existingDxGwTransitGatewayAttachId: "tgw-attach-1234",
      existingDxGwTransitGatewayRouteTableId: "tgwrtb-1234",
      existingTgwId: "tgw-1234",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "DxGw: toDc: Transit Gateway Route Table Value 'existingDxGwTransitGatewayRouteTableId' must begin with tgw-rtb-"
  );
  configContents.dxgws = {
    toDc: {
      existingDxGwTransitGatewayAttachId: "tgw-attach-1234",
      existingDxGwTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingTgwId: "tgwid-1234",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
      "DxGw: toDc: Existing Transit Gateway 'existingTgwId' must begin with tgw-"
  );
});

test("VpnRequiredOptionsMissingOrInvalid", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      newCustomerGatewayName: "testing",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: for new gateways, newCustomerGatewayIp, newCustomerGatewayAsn and newCustomerGatewayName must be specified"
  );
  configContents.vpns["onPrem"].newCustomerGatewayIp = "1,2.3.4";
  configContents.vpns["onPrem"].newCustomerGatewayAsn = 65011;
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: provided new customer gateway IP of 1,2.3.4 is not a valid IP"
  );
  delete configContents.vpns["onPrem"];
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "testing",
    },
  };
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: existing customer gateway IDs should start with cgw-"
  );
});

test("VpnCorrectDoesNotThrow", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
  delete configContents.vpns["onPrem"];
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      newCustomerGatewayAsn: 65018,
      newCustomerGatewayIp: "52.1.1.1",
      newCustomerGatewayName: "onPrem",
    },
  };
  expect(() => config.parse()).not.toThrow();
});

test("VpnCorrectViaImportDoesNotThrow", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingVpnConnectionId: "vpn-1234",
      existingVpnTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingVpnTransitGatewayAttachId: "tgw-attach-1234",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("VpnCorrectViaImportMissing", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingVpnConnectionId: "vpn-1234",
      existingVpnTransitGatewayRouteTableId: "tgw-rtb-1234",
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnTransitGatewayAttachId' that starts with 'tgw-attach-'"
  );

  configContents.vpns["onPrem"].existingVpnTransitGatewayAttachId =
    "tgw-attach-1234";
  delete configContents.vpns["onPrem"].existingVpnTransitGatewayRouteTableId;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnTransitGatewayRouteTableId' that starts with 'tgw-rtb-'"
  );

  configContents.vpns["onPrem"].existingVpnTransitGatewayRouteTableId =
    "tgw-rtb-1234";
  delete configContents.vpns["onPrem"].existingVpnConnectionId;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnConnectionId' that starts with 'vpn-'"
  );

  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingVpnConnectionId: "pn-1234",
      existingVpnTransitGatewayRouteTableId: "tgw-rtb-1234",
      existingVpnTransitGatewayAttachId: "tgw-attach-1234",
    },
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnConnectionId' that starts with 'vpn-'"
  );

  configContents.vpns["onPrem"].existingVpnConnectionId = "vpn-1234";
  configContents.vpns["onPrem"].existingVpnTransitGatewayRouteTableId =
    "tw-rtb-1234";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnTransitGatewayRouteTableId' that starts with 'tgw-rtb-'"
  );

  configContents.vpns["onPrem"].existingVpnTransitGatewayRouteTableId =
    "tgw-rtb-1234";
  configContents.vpns["onPrem"].existingVpnTransitGatewayAttachId =
    "tgw-ttach-1234";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Vpn: onPrem: Importing an existing VPN requires 'existingVpnTransitGatewayAttachId' that starts with 'tgw-attach-'"
  );
});

test("VpnMissingTransit", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
    },
  };

  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Use of VPN requires a transit gateway.  However transitGateway: was not defined."
  );
  configContents.transitGateways = {
    testing2: {
      style: "transitGateway",
      tgwDescription: "testing",
      dynamicRoutes: [
        {
          vpcName: "onPrem",
          routesTo: "dev",
        },
      ],
    },
  };
  expect(() => config.parse()).toThrow(
    "Vpn has useTransit: testing.  However no 'transitGateways:' with that name found"
  );
});

test("VpnInsideTunnelIncorrect", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
      tunnelOneOptions: {
        tunnelInsideCidr: "169.254,10.0/29",
      },
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  // Invlaid CIDR
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 169.254,10.0/29 is not valid."
  );

  configContents.vpns["onPrem"].tunnelOneOptions!.tunnelInsideCidr =
    "169.254.10.0/29";
  // CIDR not in /30
  expect(() => config.parse()).toThrow(
    "VPN Tunnel inside CDIR 169.254.10.0/29 must be a /30 range"
  );

  configContents.vpns["onPrem"].tunnelOneOptions!.tunnelInsideCidr =
    "169.253.10.0/30";
  // CIDR not in 169.254
  expect(() => config.parse()).toThrow(
    "VPN Tunnel inside CIDR 169.253.10.0/30 must be within the 169.254.0.0/16 address space"
  );

  configContents.vpns["onPrem"].tunnelOneOptions!.tunnelInsideCidr =
    "169.253.10.0/30";
  // CIDR not in 169.254
  expect(() => config.parse()).toThrow(
    "VPN Tunnel inside CIDR 169.253.10.0/30 must be within the 169.254.0.0/16 address space"
  );

  configContents.vpns["onPrem"].tunnelOneOptions!.tunnelInsideCidr =
    "169.254.5.0/30";
  // CIDR reserved by Amazon
  expect(() => config.parse()).toThrow(
    "VPN Tunnel inside CIDR 169.254.5.0/30 conflicts with Amazon reserved address space"
  );
});

test("VpnInsideTunnelCorrectNotThrow", () => {
  const configContents = minimumConfig();
  configContents.vpns = {
    onPrem: {
      style: "transitGatewayAttached",
      useTransit: "testing",
      existingCustomerGatewayId: "cgw-12345",
      tunnelOneOptions: {
        tunnelInsideCidr: "169.254.10.0/30",
      },
      tunnelTwoOptions: {
        tunnelInsideCidr: "169.254.11.0/30",
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("ProviderEndpointsRoute53ValidNoThrow", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "route53ResolverEndpoint",
        useTransit: "testing",
        resolveRequestsFromCidrs: ["10.0.0.0/8", "192.168.0.0/16"],
        forwardRequests: {
          forDomains: ["amclean.org", "amazon.com"],
          toIps: ["10.1.1.2", "10.2.1.3"],
        },
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("ProviderEndpointsRoute53InvalidThrows", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "route53ResolverEndpoint",
        useTransit: "testing",
        resolveRequestsFromCidrs: ["10.0.0.0/8", "192.168.0.0/16"],
        forwardRequests: {
          forDomains: ["amclean.org", "amazon.com"],
          toIps: ["10.1.1.2", "10.2.1.3"],
        },
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };

  // Bad IP Address in toIps Throws
  configContents.providers.endpoints!["testing"].forwardRequests!.toIps[0] =
    "10.1.x.y";
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: toIp address 10.1.x.y is not valid"
  );

  // Cidr Range in toIps throws
  configContents.providers.endpoints!["testing"].forwardRequests!.toIps[0] =
    "10.0.0.0/8";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: toIp address 10.0.0.0/8 must not be a CIDR address"
  );

  // Resolve requests from cidr not valid
  configContents.providers.endpoints!["testing"].forwardRequests!.toIps[0] =
    "10.1.1.2";
  configContents.providers.endpoints!["testing"].resolveRequestsFromCidrs![0] =
    "10.0.x.0/8";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "CIDR Address provided 10.0.x.0/8 is not valid."
  );

  // Missing forward requests and resolverequestsfromcidrs
  delete configContents.providers.endpoints!["testing"].forwardRequests;
  delete configContents.providers.endpoints!["testing"]
    .resolveRequestsFromCidrs;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: Route53 resolver requires resolveRequestsFromCidrs and/or forwardRequests are specified"
  );
});

test("ProviderEndpointsServiceInterfaceValidNoThrow", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "serviceInterfaceEndpoint",
        useTransit: "testing",
        endpointConfigFile: "sample-complex-endpoints",
        endpointMask: 24,
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("ProviderEndpointsServiceInterfaceInvalidThrows", () => {
  const configContents = minimumConfig();
  configContents.providers = {
    endpoints: {
      testing: {
        vpcCidr: "10.1.0.0/17",
        style: "serviceInterfaceEndpoint",
        useTransit: "testing",
        endpointConfigFile: "sample-complex-endpoints",
        endpointMask: 24,
      },
    },
  };
  configContents.transitGateways = {
    testing: {
      style: "transitGateway",
      tgwDescription: "testing",
    },
  };
  // Endpoint Config file doesn't exist
  configContents.providers.endpoints!["testing"].endpointConfigFile =
    "blahblahblah";
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: Service interface file blahblahblah-us-east-1.txt not found in the config directory"
  );

  // endpointMask is not valid
  configContents.providers.endpoints!["testing"].endpointConfigFile =
    "sample-complex-endpoints";
  configContents.providers.endpoints!["testing"].endpointMask = 100;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: endpointMask of 100 was given.  Valid values are between 16 and 28"
  );

  // endpointConfigFile missing entirely
  configContents.providers.endpoints!["testing"].endpointMask = 24;
  delete configContents.providers.endpoints!["testing"].endpointConfigFile;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "Endpoint testing: Service interfaces requires endpointConfigFile be specified"
  );
});

test("DnsValidNoThrow", () => {
  const configContents = minimumConfig();
  configContents.dns = {
    testing: {
      domains: ["example.com"],
      shareWithVpcs: ["dev"],
      shareWithExistingVpcs: [
        {
          vpcId: "vpc-12345",
          vpcRegion: "us-east-2",
        },
      ],
    },
  };
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).not.toThrow();
});

test("DnsInvalidThrows", () => {
  const configContents = minimumConfig();
  configContents.dns = {
    testing: {
      domains: ["example.com"],
      shareWithVpcs: ["dev"],
      shareWithExistingVpcs: [
        {
          vpcId: "vpc-12345",
          vpcRegion: "us-east-2",
        },
      ],
    },
  };

  // domains don't have a dot
  configContents.dns["testing"].domains[0] = "example";
  let config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "DNS: testing: Contains a domain example.  Does not appear to be a valid domain.  Should contain at least one ."
  );

  // shareWithVpcs target doesn't exist in configuration file
  configContents.dns["testing"].domains[0] = "example.com";
  configContents.dns["testing"].shareWithVpcs![0] = "doesntexist";
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "DNS: testing: contains sharedWithVpc value of doesntexist.  Unable to find doesntexist as a VPC or Provider in the configuration."
  );

  // vpc id not formatted property in shareWithExistingVpcs
  configContents.dns["testing"].shareWithVpcs![0] = "dev";
  configContents.dns["testing"].shareWithExistingVpcs![0] = {
    vpcId: "something",
    vpcRegion: "us-east-2",
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "DNS: testing: contains shareWithExistingVpc with vpc ID something.  This value must start with 'vpc-'"
  );

  // region not formatted property in shareWithExistingVpcs
  configContents.dns["testing"].shareWithExistingVpcs![0] = {
    vpcId: "vpc-12345",
    vpcRegion: "virginia",
  };
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "DNS testing: Contains shareWithExistingVpc with region virginia.  This does not appear valid.  Use format ie: us-east-1"
  );

  // neither shareWithExistingVpcs nor shareWithVpcs exists
  delete configContents.dns["testing"].shareWithExistingVpcs;
  delete configContents.dns["testing"].shareWithVpcs;
  config = new ConfigParser({ configContents: configContents });
  expect(() => config.parse()).toThrow(
    "DNS: testing: Private hosted zone must be associated with at least one VPC.  'shareWithVpcs' and/or 'shareWithExistingVpcs' are required"
  );
});
