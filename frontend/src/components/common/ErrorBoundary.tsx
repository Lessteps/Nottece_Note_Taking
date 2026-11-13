// Una superficie que falla no puede llevarse la ventana por delante.
//
// React desmonta la raíz entera cuando un render lanza: la ventana se queda en
// blanco, sin error que leer, que es exactamente lo que se ve como «esta nota
// rompe la app». Esta red envuelve la superficie de la nota, muestra qué nota fue
// y el error, y la nota sigue siendo utilizable (en crudo, desde Editar).

import { Component, type ReactNode } from "react";

interface Props {
  /** La nota cuya superficie se está pintando: cambiarla reinicia la red. */
  path?: string;
  /** Qué se estaba pintando (para el mensaje). */
  what?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export function isModuleLoadError(error: Error): boolean {
  return /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk [\w-]+ failed|importing a module script failed/i.test(error.message);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // Queda en la consola de la ventana: es lo único que se puede leer cuando la
    // superficie no se pinta.
    console.error(`[NoteVault] ${this.props.what ?? "vista"} no se pudo pintar`, this.props.path, error, info?.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    // Otra nota, otra oportunidad: la red se limpia al cambiar de archivo.
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const moduleLoadFailed = isModuleLoadError(error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-[15px] font-semibold text-text">
          {this.props.what ?? "Esta vista"} no se pudo pintar
        </div>
        <p className="max-w-lg text-[12.5px] leading-relaxed text-dim">
          {this.props.path ? <>La nota sigue intacta en el disco. Puedes cambiar a <b className="text-text">Editar</b> o abrir otra nota.</> : <>No se pudo mostrar esta sección. Puedes reintentarlo o cambiar a otra parte de la aplicación.</>} El error queda anotado en la consola.
        </p>
        {moduleLoadFailed && <p className="max-w-lg text-[12.5px] text-dim">Para recuperar el módulo hay que recargar la aplicación. Los cambios que no hayas guardado podrían perderse.</p>}
        <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover" onClick={() => moduleLoadFailed ? window.location.reload() : this.setState({ error: null })}>{moduleLoadFailed ? "Recargar aplicación" : "Reintentar"}</button>
        <div className="max-w-lg rounded-lg border border-line bg-card px-3 py-2 text-left">
          <div className="truncate font-mono text-[11px] text-faint" title={this.props.path}>
            {this.props.path ?? "—"}
          </div>
          <div className="mt-1 break-words font-mono text-[11.5px]" style={{ color: "var(--nv-danger)" }}>
            {error.name}: {error.message}
          </div>
        </div>
      </div>
    );
  }
}
