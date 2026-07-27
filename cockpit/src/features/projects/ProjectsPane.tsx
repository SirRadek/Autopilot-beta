import React, { useState, type FormEvent } from "react";

import type { ProjectCreateInput, ProjectEntry } from "../../types/controlPlane";

export type ProjectsPaneProps = {
  readonly projects: readonly ProjectEntry[];
  readonly selectedProjectId?: string;
  readonly onSelect: (projectId: string) => void;
  readonly onCreate: (input: ProjectCreateInput) => void | Promise<void>;
  readonly error?: string;
};

export function ProjectsPane({ projects, selectedProjectId, onSelect, onCreate, error }: ProjectsPaneProps) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(undefined);
    try {
      await onCreate({ name, cwd });
      setName("");
      setCwd("");
    } catch (submissionError) {
      setCreateError(submissionError instanceof Error ? submissionError.message : "Projekt se nepodařilo vytvořit");
    } finally {
      setCreating(false);
    }
  }

  return <div className="projects-pane">
    {error ? <p className="projects-error" role="alert">Relace nejsou dostupné: {error}</p> : null}
    <ul className="project-list">
      {projects.map((project) => <li key={project.project_id}>
        <button
          type="button"
          className="project-select"
          aria-label={`Vybrat projekt ${project.name}`}
          aria-pressed={project.project_id === selectedProjectId}
          onClick={() => onSelect(project.project_id)}
        >
          <span className="project-name">{project.name}</span>
          <span className={`project-state ${project.enabled ? "project-state-enabled" : "project-state-disabled"}`}>
            {project.enabled ? "Aktivní" : "Vypnutý"}
          </span>
          <span className="project-cwd" title={project.cwd}>{project.cwd}</span>
        </button>
      </li>)}
    </ul>
    <form className="project-create" onSubmit={submit} aria-labelledby="new-project-title">
      <h3 id="new-project-title">Nový projekt</h3>
      <label htmlFor="project-name">Název</label>
      <input id="project-name" name="name" value={name} onChange={(event) => setName(event.target.value)} required />
      <label htmlFor="project-cwd">Absolutní cesta</label>
      <input id="project-cwd" name="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} required />
      <button type="submit" disabled={creating}>{creating ? "Vytvářím…" : "Vytvořit projekt"}</button>
      {createError ? <p className="projects-error" role="alert">{createError}</p> : null}
    </form>
  </div>;
}
