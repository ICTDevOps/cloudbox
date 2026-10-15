// Sélecteur de dossier du formulaire de création : parcourt les dossiers de /home/dev
// (GET /api/folders, sans les dossiers cachés). Le dossier choisi est créé s'il n'existe pas encore.
import { useEffect, useState } from 'preact/hooks';
import { api, type FolderList } from './api';
import { t } from './i18n';
import { Icon } from './icons';

const HOME = '/home/dev';

function shown(path: string): string {
  return path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

export function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const m = t().folders;
  const [list, setList] = useState<FolderList | null>(null);
  const [error, setError] = useState('');

  const open = (path: string) => {
    setError('');
    api.folders(path).then(setList).catch((err: Error) => {
      // Dossier pas encore créé (valeur saisie) : on repart du home
      if (path !== HOME) open(HOME);
      else setError(err.message);
    });
  };
  useEffect(() => open(start || HOME), []);

  return (
    <div class="folder-picker" role="group" aria-label={m.title}>
      <div class="folder-picker-head">
        <button type="button" class="button ghost small" disabled={!list?.parent} onClick={() => list?.parent && open(list.parent)}
          aria-label={m.up} title={m.up}>
          <Icon name="arrowUp" size={16} />
        </button>
        <code class="folder-current"><span>{list ? shown(list.path) : '…'}</span></code>
        <button type="button" class="button ghost small" onClick={onClose} aria-label={t().common.close}><Icon name="close" size={16} /></button>
      </div>
      {error && <p class="error">{error}</p>}
      <ul class="folder-list">
        {list?.folders.map((name) => (
          <li key={name}>
            <button type="button" onClick={() => open(`${list.path}/${name}`)}>
              <Icon name="folder" size={16} /> {name}
            </button>
          </li>
        ))}
        {list && !list.folders.length && <li class="muted">{m.empty}</li>}
      </ul>
      <div class="folder-picker-foot">
        <span class="field-help">{m.help}</span>
        <button type="button" class="button primary small" disabled={!list} onClick={() => list && onPick(list.path)}>
          {m.choose}
        </button>
      </div>
    </div>
  );
}
