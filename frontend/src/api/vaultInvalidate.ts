// Olvida TODO lo que la app tiene en memoria sobre el contenido de la vault (índices, fotos de temas, cobertura, ejercicios). Se llama cuando el vigilante de
// archivos ve cambios hechos fuera de la app, para que lo nuevo aparezca solo, sin reindexar ni reiniciar.

import { clearExerciseIndexCache } from "../core/practice/exerciseIndex.js";
import { VaultIndex } from "../core/vaultIndex.js";
import { clearStudySnapshotCache } from "./modules/study.js";
import { clearTopicSnapCache } from "./modules/topicSnapCache.js";

export function invalidateVaultCaches(root?: string): void {
  clearStudySnapshotCache(); // incluye el escaneo de la vault (y con él la cobertura del currículo, que cuelga de ese escaneo)
  clearTopicSnapCache(root);
  clearExerciseIndexCache();
  if (root) {
    VaultIndex.forVault({ vaultRoot: root, notePaths: () => [] }).invalidate();
  }
}
