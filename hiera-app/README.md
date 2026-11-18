# Hiera — assistant IA indépendant

Hiera est une application indépendante avec sa propre interface et son propre serveur de connexion aux modèles IA.

## Prérequis

- Node.js 20 ou plus récent
- npm
- Une clé API OpenAI avec accès API et une facturation configurée auprès du fournisseur

## Installation locale

Depuis le dossier `hiera-app` :

```bash
npm install
```

Copie `.env.example` vers `.env`, puis ajoute ta clé dans le fichier local :

```env
Key_API_Hiera=ta_cle_api_ici
HIERA_API_PORT=3001
```

Démarre Hiera :

```bash
npm run dev
```

Ouvre ensuite http://localhost:5173.

## Utiliser le secret GitHub

Le serveur accepte le nom exact `Key_API_Hiera` comme variable d'environnement. Il accepte aussi `OPENAI_API_KEY` pour rester compatible avec les installations existantes.

Le secret GitHub Actions nommé `Key_API_Hiera` n'est pas transmis automatiquement à un serveur hébergé. Le workflow ou la plateforme d'hébergement doit explicitement l'injecter dans l'environnement du processus Node, par exemple dans un workflow GitHub Actions :

```yaml
env:
  Key_API_Hiera: ${{ secrets.Key_API_Hiera }}
```

Cette configuration ne déploie pas à elle seule le serveur : il faut encore choisir une plateforme d'hébergement et lui transmettre le secret de façon sécurisée.

## Sécurité des clés

- La clé API est lue uniquement par le serveur Node.
- Ne mets jamais la clé dans `src/`, dans une variable `VITE_*`, dans le code du dépôt ou dans un message.
- Le fichier `.env` est ignoré par Git.
- Ne déploie pas le serveur de développement tel quel sur Internet. Avant un déploiement public, ajouter authentification, limitation de débit, protection anti-abus et configuration HTTPS.

## Fonctionnalités

- Interface de conversation responsive.
- Identité visuelle violette avec atome flottant.
- Appels réels à l'API OpenAI via le serveur.
- Choix entre GPT-4.1 mini et GPT-4.1.
- Affichage de l'état de génération et des erreurs.

## Architecture

- `src/` : interface React.
- `server/index.mjs` : proxy serveur sécurisé pour les appels API.
- `.env.example` : modèle de configuration, sans secret.

Les réponses de l'assistant proviennent de l'API configurée ; Hiera ne fabrique pas de réponses de remplacement en cas d'échec.
