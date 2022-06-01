import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as r53 from "aws-cdk-lib/aws-route53";
import { IBuilderVpc } from "./types";
import { IConfigDnsShareWithExistingVpc } from "./config/config-types";
// We'll need our 'shareWithVpcs' to be IBuilderVpcs to establish a relationship and assure order
// When we're deploying within the app.  Our existing ones are less important and can be strings.
interface IDnsEntriesProps {
  domains: Array<string>;
  shareWithVpcs?: Array<IBuilderVpc>;
  shareWithExistingVpcs?: Array<IConfigDnsShareWithExistingVpc>;
}

export interface IDnsRoute53PrivateHostedZonesProps extends cdk.StackProps {
  namePrefix: string;
  dnsEntries: IDnsEntriesProps;
}

interface IPrivateZoneName {
  domain: string;
  phz: r53.CfnHostedZone;
}

export class DnsRoute53PrivateHostedZonesClass extends cdk.Stack {
  name: string;
  props: IDnsRoute53PrivateHostedZonesProps;
  privateZoneNames: Array<IPrivateZoneName> = [];

  constructor(
    scope: Construct,
    id: string,
    props: IDnsRoute53PrivateHostedZonesProps
  ) {
    super(scope, id, props);

    this.props = props;
    this.name = `${props.namePrefix}-dns-private-hosted-zones`.toLowerCase();

    for (const domain of props.dnsEntries.domains) {
      const privateHostedZone = new r53.CfnHostedZone(
        this,
        `PrivateHostedZone-${domain}`,
        {
          hostedZoneConfig: {
            comment: `Private Hosted Zone for ${domain}`,
          },
          name: domain,
          vpcs: this.buildVpcList(),
        }
      );
      // Record our creation.
      const privateHostedZoneNamed: IPrivateZoneName = {
        domain: domain,
        phz: privateHostedZone,
      };
      this.privateZoneNames.push(privateHostedZoneNamed);
    }
  }

  buildVpcList() {
    const dnsEntries = this.props.dnsEntries;
    const vpcs: Array<r53.CfnHostedZone.VPCProperty> = [];
    if (dnsEntries.shareWithVpcs) {
      for (const builderVpc of dnsEntries.shareWithVpcs) {
        vpcs.push({
          vpcId: builderVpc.vpc.vpcId,
          vpcRegion: this.region,
        });
      }
    }
    if (dnsEntries.shareWithExistingVpcs) {
      for (const importVpc of dnsEntries.shareWithExistingVpcs) {
        vpcs.push({
          vpcId: importVpc.vpcId,
          vpcRegion: importVpc.vpcRegion,
        });
      }
    }
    return vpcs;
  }
}
