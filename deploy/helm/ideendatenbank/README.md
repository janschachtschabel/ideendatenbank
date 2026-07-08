# edu_sharing-projects-wlo-ideendatenbank

Helm chart for the **HackathOERn Ideendatenbank** — a single-container application
(FastAPI backend + embedded Angular frontend, served on port `8000`). State lives
in a single SQLite database plus ZIP backups on one persistent `/data` volume.

> **Single replica only.** SQLite is a single-writer store on one PVC, so the chart
> deploys a `StatefulSet` with `replicaCount: 1`. Do not scale this chart horizontally.

## Install

```bash
helm install ideendb deploy/helm/ideendatenbank \
  --set config.edu.guestUser=<from-WLO> \
  --set config.edu.guestPass=<from-WLO> \
  --set ingress.hosts[0]=ideen.example.de \
  --set config.app.corsOrigins=https://ideen.example.de
```

`config.edu.guestUser` and `config.edu.guestPass` are **required** — rendering fails
without them. They are stored in the chart-managed `Secret` (`<release>-...-env`).

## Parameters

### Global parameters

| Name                                       | Description                                  | Value                          |
| ------------------------------------------ | -------------------------------------------- | ------------------------------ |
| `global.annotations`                       | Define global annotations added to every pod | `{}`                           |
| `global.cluster.cert.annotations`          | Set custom global cert annotations           | `{}`                           |
| `global.cluster.domain`                    | Set global domain for the cluster            | `cluster.local`                |
| `global.cluster.ingress.ingressClassName`  | Set global ingress class name                | `nginx`                        |
| `global.cluster.pdb.enabled`               | Enable PodDisruptionBudget                   | `false`                        |
| `global.debug`                             | Enable global debugging                      | `false`                        |
| `global.image.pullPolicy`                  | Set global image pullPolicy                  | `IfNotPresent`                 |
| `global.image.pullSecrets`                 | Set global image pullSecrets                 | `[]`                           |
| `global.image.registry`                    | Set global image container registry          | `docker.edu-sharing.com`       |
| `global.image.repository`                  | Set global image container repository        | `projects/wlo/ideendatenbank`  |
| `global.metrics.servicemonitor.enabled`    | Enable a Prometheus ServiceMonitor           | `false`                        |
| `global.security`                          | Custom pod security context (merged)         | `{}`                           |

### Local parameters

| Name                                  | Description                                                          | Value                       |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| `nameOverride`                        | Override the chart name used for resource names                      | `""`                        |
| `fullnameOverride`                    | Fully override the generated resource name                           | `""`                        |
| `image.name`                          | Override image repository (defaults to registry/repository)          | `""`                        |
| `image.tag`                           | Set image tag (defaults to `.Chart.AppVersion`)                      | `""`                        |
| `replicaCount`                        | Amount of replicas — MUST stay 1 (single-writer SQLite)              | `1`                         |
| `service.type`                        | Set service type                                                     | `ClusterIP`                 |
| `service.port`                        | Set service port (cluster-internal)                                  | `8000`                      |
| `ingress.enabled`                     | Enable ingress                                                       | `true`                      |
| `ingress.hosts`                       | Set ingress hosts                                                    | `["ideen.127.0.0.1.nip.io"]`|
| `ingress.paths`                       | Set paths served from the host                                       | `["/"]`                     |
| `ingress.tls`                         | Set TLS for ingress                                                  | `[]`                        |
| `ingress.annotations.*`               | nginx body-size / proxy-timeout annotations                          | see `values.yaml`           |
| `debug`                               | Enable debugging for this release                                    | `false`                     |

### Application configuration

| Name                                   | Description                                                            | Value                                    |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| `config.edu.repoBaseUrl`               | Repository base URL (drives API + links)                               | `https://redaktion.openeduhub.net`       |
| `config.edu.repoApi`                   | Explicit API base; empty → derived from `repoBaseUrl`                  | `""`                                     |
| `config.edu.guestInboxId`              | Inbox collection id for anonymous submissions                          | `21144164-30c0-4c01-ae16-264452197063`   |
| `config.edu.rootCollectionId`          | Root collection id of the idea database                                | `4197d4d2-c700-400c-97d4-d2c700900c68`   |
| `config.edu.guestUser`                 | edu-sharing guest username (**REQUIRED**, stored in Secret)            | `""`                                     |
| `config.edu.guestPass`                 | edu-sharing guest password (**REQUIRED**, stored in Secret)            | `""`                                     |
| `config.app.corsOrigins`               | Comma-separated allowed browser origins                                | `https://ideen.example.de`               |
| `config.app.syncNightlyHour`           | UTC hour (0–23) of the nightly full repository sync                    | `1`                                      |
| `config.backup.enabled`                | Enable periodic ZIP backups of the SQLite DB                           | `true`                                   |
| `config.backup.intervalHours`          | Backup interval in hours                                               | `24`                                     |
| `config.backup.keep`                   | Number of backups to retain                                            | `3`                                      |
| `config.backup.autoRestoreMarker`      | Marker filename opting in to auto-restore on first start               | `AUTO_RESTORE_OK`                        |
| `config.upload.imageMaxBytes`          | Max bytes for preview images                                           | `10485760`                               |
| `config.upload.contentMaxBytes`        | Max bytes for idea main content                                        | `52428800`                               |
| `config.upload.attachmentMaxBytes`     | Max bytes per attachment                                               | `52428800`                               |
| `config.upload.restoreMaxBytes`        | Max bytes for a backup-restore upload                                  | `209715200`                              |
| `config.moderation.fallbackGroups`     | Comma-separated edu-sharing groups granted moderation rights           | `GROUP_ALFRESCO_ADMINISTRATORS`          |
| `config.moderation.bootstrapUsers`     | Comma-separated usernames bootstrapped as moderators                   | `""`                                     |
| `config.llm.enabled`                   | Enable optional LLM integration                                        | `false`                                  |
| `config.llm.baseUrl`                   | LLM API base URL                                                       | `""`                                     |
| `config.llm.model`                     | LLM model id                                                           | `""`                                     |
| `config.llm.apiKey`                    | LLM API key (stored in Secret)                                         | `""`                                     |
| `config.extraEnv`                      | Extra plain environment variables (map)                                | `{}`                                     |

### Storage, scheduling & runtime

| Name                                   | Description                                                            | Value                |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| `persistence.enabled`                  | Enable persistent storage for `/data`                                  | `true`               |
| `persistence.mountPath`                | Mount path for the data volume                                         | `/data`              |
| `persistence.storageClassName`         | StorageClass for the data PVC (empty → cluster default)               | `""`                 |
| `persistence.accessModes`              | Access modes for the data PVC                                          | `["ReadWriteOnce"]`  |
| `persistence.size`                     | Storage request for the data PVC                                       | `2Gi`                |
| `nodeAffinity`                         | Set node affinity                                                      | `{}`                 |
| `tolerations`                          | Set tolerations                                                        | `[]`                 |
| `podAnnotations`                       | Set custom pod annotations                                             | `{}`                 |
| `podSecurityContext.fsGroup`           | Set fs group for volume access                                         | `999`                |
| `podSecurityContext.fsGroupChangePolicy` | Set change policy for fs group                                       | `OnRootMismatch`     |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation                                         | `false`              |
| `securityContext.readOnlyRootFilesystem` | Mount the root filesystem read-only                                  | `false`              |
| `securityContext.capabilities.drop`    | Set drop capabilities                                                  | `["ALL"]`            |
| `securityContext.runAsNonRoot`         | Require running as non-root                                            | `true`               |
| `securityContext.runAsUser`            | User id to run as (image's `app` user)                                 | `999`                |
| `terminationGracePeriod`               | Grace period for termination in seconds                                | `60`                 |
| `startupProbe.*`                       | Startup probe tuning (`GET /api/v1/health`)                            | see `values.yaml`    |
| `livenessProbe.*`                      | Liveness probe tuning (`GET /api/v1/health`)                           | see `values.yaml`    |
| `readinessProbe.*`                     | Readiness probe tuning (`GET /api/v1/ready` — DB check)                | see `values.yaml`    |
| `resources.limits.cpu`                 | Set CPU limit on resources                                             | `1000m`              |
| `resources.limits.memory`              | Set memory limit on resources                                          | `1Gi`                |
| `resources.requests.cpu`               | Set CPU for requests on resources                                      | `250m`               |
| `resources.requests.memory`            | Set memory for requests on resources                                   | `512Mi`              |
