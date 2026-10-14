// Masquage des secrets avant tout envoi à un fournisseur d'IA et avant tout enregistrement d'une
// conversation : sortie de terminal, fichiers lus, messages de l'utilisateur.
//
// Masquage par motifs : il réduit le risque, il ne le supprime pas (un secret sans forme reconnaissable
// passe). Le portail le dit à l'utilisateur.

const MASK = '[masqué]';

interface Rule {
  name: string;
  re: RegExp;
  // Remplacement : le masque seul, ou une fonction qui garde le préfixe (nom de la clé, en-tête…)
  replace: string | ((match: string, ...groups: string[]) => string);
}

const keep = (_m: string, prefix: string) => `${prefix}${MASK}`;

const RULES: Rule[] = [
  // Clés privées PEM (RSA, EC, OPENSSH, chiffrées…) : tout le bloc
  {
    name: 'pem',
    re: /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    replace: `-----BEGIN PRIVATE KEY-----${MASK}-----END PRIVATE KEY-----`,
  },
  // Jetons JWT (accès Entra ID, MSAL, kubelogin…) : trois segments base64url, en-tête « eyJ »
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: MASK },
  // En-tête Authorization (Bearer, Basic, SharedKey…)
  { name: 'authorization', re: /(\bAuthorization\s*[:=]\s*["']?(?:Bearer|Basic|SharedKey|SharedAccessSignature)\s+)[^\s"',;]+/gi, replace: keep },
  { name: 'bearer', re: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, replace: keep },
  // Chaînes de connexion Azure Storage, Service Bus, Event Hubs, Cosmos DB
  { name: 'account-key', re: /((?:AccountKey|SharedAccessKey|PrimaryKey|SecondaryKey)\s*=\s*)[^;"'\s]+/gi, replace: keep },
  // Jetons SAS (paramètre sig= d'une URL ou d'une chaîne SAS)
  { name: 'sas', re: /([?&;]sig=)[^&"'\s]+/gi, replace: keep },
  // Clés de stockage et clés Cosmos DB affichées seules (base64 de 64 octets, terminé par « == »)
  { name: 'storage-key', re: /\b[A-Za-z0-9+/]{86}==/g, replace: MASK },
  // Mots de passe et secrets dans une chaîne de connexion ou une affectation
  {
    name: 'assignment',
    re: /(\b(?:password|passwd|pwd|secret|client_?secret|clientsecret|api_?key|apikey|access_?key|secret_?key|token|access_?token|refresh_?token|connection_?string)\b["']?\s*[:=]\s*["']?)(?!\[masqué\])[^\s"',;}]{4,}/gi,
    replace: keep,
  },
  // Paramètres PowerShell porteurs de secret : -ClientSecret xxx, -Password xxx, -CertificatePassword xxx
  {
    name: 'ps-param',
    re: /(-(?:ClientSecret|Password|CertificatePassword|AccessToken|ApplicationSecret|Secret)\s+["']?)(?![$(]|\[masqué\])[^\s"']{4,}/gi,
    replace: keep,
  },
  // Secrets client Entra ID (format actuel : 3 caractères, « 8Q~ », puis 31 caractères)
  { name: 'entra-secret', re: /\b[A-Za-z0-9_-]{3}\dQ~[A-Za-z0-9_.~-]{31,34}\b/g, replace: MASK },
  // Jetons GitHub, clés des fournisseurs d'IA, clés AWS
  { name: 'github', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g, replace: MASK },
  { name: 'ai-key', re: /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{20,}/g, replace: MASK },
  { name: 'aws', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: MASK },
  // Code de connexion « device code » (az login, Connect-MgGraph…) : utilisable par un tiers pendant
  // quelques minutes
  { name: 'device-code', re: /(enter the code\s+)[A-Z0-9]{8,9}\b/gi, replace: keep },
];

// Valeurs secrètes connues de cloudbox-api (jeton d'accès Cloudbox, clés API des fournisseurs) :
// masquées à l'identique, quelle que soit leur forme. Tenues à jour par config.ts.
let known: string[] = [];

export function setKnownSecrets(values: (string | undefined)[]): void {
  known = [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length >= 8).map((v) => v.trim()))]
    .sort((a, b) => b.length - a.length);
}

export interface Redaction {
  text: string;
  // Nombre de valeurs masquées, par règle
  counts: Record<string, number>;
}

export function redact(input: string): Redaction {
  let text = input;
  const counts: Record<string, number> = {};
  for (const value of known) {
    const parts = text.split(value);
    if (parts.length > 1) {
      counts.known = (counts.known ?? 0) + parts.length - 1;
      text = parts.join(MASK);
    }
  }
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      counts[rule.name] = (counts[rule.name] ?? 0) + 1;
      if (typeof rule.replace === 'string') return rule.replace;
      const groups = args.slice(0, -2).map(String);
      return rule.replace(groups[0], ...groups.slice(1));
    });
  }
  return { text, counts };
}

export function redactText(input: string): string {
  return redact(input).text;
}
