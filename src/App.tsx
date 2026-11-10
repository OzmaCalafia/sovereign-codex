// App shell: Read tab (Archive reader) and Write tab (encrypted local [SC] with entries).
import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { db, wipeLocalVault, type EntryRecord } from './db/database';
import {
  generateBip39Seed,
  validateBip39Seed,
  generateSaltHex,
  generateMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  encryptData,
  decryptData,
} from './lib/crypto';
import {
  serializeCodexEntry,
  buildCodexPreview,
  getSequenceLabel,
  getSequencePrompts,
  isValidCitizenInitials,
  normalizeCitizenInitials,
  parseCodexEntry,
  type CodexSequence,
} from './lib/codex';
import { sourceRepositoryUrl } from './lib/sourceRepository';
import {
  BACKUP_VERSION,
  decryptBackupPayload,
  encryptBackupPayload,
  parseBackup,
  parseEncryptedBackup,
  type BackupCredential,
  type BackupPayload,
  type EncryptedBackupEnvelope,
} from './lib/backup';
import { useLiveQuery } from 'dexie-react-hooks';

const ArchiveReader = lazy(() => import('./ArchiveReader'));

/** Message text from an unknown thrown value. */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export default function App() {
  // Navigation, unlock, and session state
  const [activeSection, setActiveSection] = useState<'writing' | 'archive'>('writing');
  const [activeTab, setActiveTab] = useState<'unlock' | 'recover'>('unlock');
  const [mainPassword, setMainPassword] = useState('');
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState('');
  const [replacementPassword, setReplacementPassword] = useState('');
  const [confirmReplacementPassword, setConfirmReplacementPassword] = useState('');
  const [passwordForSignature, setPasswordForSignature] = useState('');
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [status, setStatus] = useState('');

  // Provisioning state
  const [setupPassword, setSetupPassword] = useState('');
  const [setupInitials, setSetupInitials] = useState('');
  const [generatedSeed, setGeneratedSeed] = useState<string[]>([]);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
  const recoveryPhraseCleared = useRef(false);

  // Recovery state
  const [recoverySeedInput, setRecoverySeedInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [citizenInitials, setCitizenInitials] = useState('');
  const [initialsDraft, setInitialsDraft] = useState('');

  // Records state
  const [entryTitle, setEntryTitle] = useState('');
  const [entrySequence, setEntrySequence] = useState<CodexSequence>('A');
  const [entryCatalyst, setEntryCatalyst] = useState('');
  const [entryFriction, setEntryFriction] = useState('');
  const [entryParameter, setEntryParameter] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [decryptedRecords, setDecryptedRecords] = useState<Record<number, string>>({});
  const [backupDialog, setBackupDialog] = useState<'export' | 'import' | null>(null);
  const [backupCredential, setBackupCredential] = useState<BackupCredential>('password');
  const [backupSecret, setBackupSecret] = useState('');
  const [pendingEncryptedBackup, setPendingEncryptedBackup] = useState<EncryptedBackupEnvelope | null>(null);
  const [pendingLegacyBackup, setPendingLegacyBackup] = useState<BackupPayload | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [returnToImportAfterExport, setReturnToImportAfterExport] = useState(false);

  // Used by the Archive's closing link: opens Write and focuses its first section.
  const beginEntry = () => {
    setActiveSection('writing');
    requestAnimationFrame(() => {
      const target = document.getElementById('sc-write-start');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
  };

  const vaultConfig = useLiveQuery(() => db.vaultConfig.toCollection().first());
  const entries = useLiveQuery(() => db.entries.toArray());
  const sequenceGuidance = getSequencePrompts(entrySequence);

  // Create a recovery phrase only while setting up a new [SC].
  useEffect(() => {
    if (!vaultConfig && generatedSeed.length === 0 && !recoveryPhraseCleared.current) {
      generateBip39Seed().then(setGeneratedSeed);
    }
  }, [vaultConfig, generatedSeed.length]);

  // Decrypts and shows the stored signature, or clears it for older [SC]s that have none.
  const loadSignature = async (mek: CryptoKey, encrypted?: string) => {
    const initials = encrypted ? await decryptData(encrypted, mek) : '';
    setCitizenInitials(initials);
    setInitialsDraft(initials);
  };

  // Setup and local data lifecycle
  const handleFactoryReset = async () => {
    const confirmed = window.confirm(
      "This permanently erases [SC] and every entry stored in this browser.\n\n" +
      "If you do not have your 24-word seed phrase or .sc backup file saved, your data will be unrecoverable.\n\n" +
      "Continue and erase this local [SC]?"
    );

    if (confirmed) {
      await wipeLocalVault();
      setMasterKey(null);
      setSetupPassword('');
      setSetupInitials('');
      setMainPassword('');
      setCurrentPasswordForChange('');
      setReplacementPassword('');
      setConfirmReplacementPassword('');
      setPasswordForSignature('');
      setRecoverySeedInput('');
      setNewPassword('');
      setCitizenInitials('');
      setInitialsDraft('');
      setSeedConfirmed(false);
      recoveryPhraseCleared.current = false;

      const newSeed = await generateBip39Seed();
      setGeneratedSeed(newSeed);
      setStatus('[SC] erased.');
    }
  };

  // Export and import portable .sc backups
  const handleExportVault = () => {
    setBackupSecret('');
    setBackupDialog('export');
  };

  const downloadBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupSecret) return;

    try {
      const config = await db.vaultConfig.toCollection().first();
      const allEntries = await db.entries.toArray();
      const logs = await db.auditLogs.toArray();

      if (!config || !masterKey) throw new Error('Unlock [SC] before creating a backup.');
      setBackupBusy(true);
      const verifiedMasterKey = await unwrapMasterKey(config.wrappedMEKByPassword, backupSecret, config.salt);
      const keyCheck = await encryptData('sovereign-codex:backup-key-check', masterKey);
      if (await decryptData(keyCheck, verifiedMasterKey) !== 'sovereign-codex:backup-key-check') {
        throw new Error('The active session key does not match the stored password key slot.');
      }

      const exportPayload: BackupPayload = {
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        vaultConfig: config,
        entries: allEntries,
        auditLogs: logs,
      };
      const envelope = await encryptBackupPayload(exportPayload, {
        salt: config.salt,
        wrappedMEKByPassword: config.wrappedMEKByPassword,
        wrappedMEKBySeed: config.wrappedMEKBySeed,
      }, verifiedMasterKey);
      const jsonString = JSON.stringify(envelope);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `sovereign-codex-${Date.now()}.sc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setBackupDialog(returnToImportAfterExport ? 'import' : null);
      setReturnToImportAfterExport(false);
      setBackupSecret('');
      setStatus('Portable .sc backup exported.');
    } catch (err: unknown) {
      setStatus(err instanceof DOMException && err.name === 'OperationError'
        ? 'Backup failed. Check the current password and try again.'
        : `Backup failed: ${getErrorMessage(err)}`);
    } finally {
      setBackupBusy(false);
      setBackupSecret('');
    }
  };

  const replaceLocalVault = async (data: BackupPayload) => {
    await db.transaction('rw', [db.entries, db.vaultConfig, db.auditLogs], async () => {
      await db.entries.clear();
      await db.vaultConfig.clear();
      await db.auditLogs.clear();

      await db.vaultConfig.add(data.vaultConfig);
      if (data.entries.length > 0) await db.entries.bulkAdd(data.entries);
      if (data.auditLogs.length > 0) await db.auditLogs.bulkAdd(data.auditLogs);
    });

    recoveryPhraseCleared.current = true;
    setGeneratedSeed([]);
    setSeedConfirmed(false);
    setSetupPassword('');
    setBackupDialog(null);
    setBackupSecret('');
    setPendingEncryptedBackup(null);
    setPendingLegacyBackup(null);
    window.location.reload();
  };

  const handleEncryptedBackupImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!pendingEncryptedBackup && !pendingLegacyBackup) || !backupSecret) return;

    setBackupBusy(true);
    try {
      const credentialSecret = backupCredential === 'recoveryPhrase'
        ? backupSecret.trim().toLowerCase().split(/\s+/).join(' ')
        : backupSecret;
      if (backupCredential === 'recoveryPhrase' && !await validateBip39Seed(credentialSecret.split(' '))) {
        throw new Error('Invalid recovery phrase.');
      }
      let data: BackupPayload;
      if (pendingEncryptedBackup) {
        data = await decryptBackupPayload(pendingEncryptedBackup, credentialSecret, backupCredential);
      } else if (pendingLegacyBackup) {
        if (backupCredential === 'recoveryPhrase' && !await validateBip39Seed(credentialSecret.split(' '))) {
          throw new Error('Invalid recovery phrase.');
        }
        await unwrapMasterKey(
          backupCredential === 'password'
            ? pendingLegacyBackup.vaultConfig.wrappedMEKByPassword
            : pendingLegacyBackup.vaultConfig.wrappedMEKBySeed,
          credentialSecret,
          pendingLegacyBackup.vaultConfig.salt,
        );
        data = pendingLegacyBackup;
      } else {
        return;
      }
      const confirmed = window.confirm(
        `${pendingLegacyBackup ? 'This legacy backup does not encrypt all metadata. ' : ''}` +
        'Opening this backup replaces [SC] and its entries currently stored in this browser.\n\nContinue?'
      );
      if (confirmed) await replaceLocalVault(data);
    } catch {
      alert('Backup could not be opened. Check the selected credential and try again.');
    } finally {
      setBackupBusy(false);
      setBackupSecret('');
    }
  };

  // Replace local data with a .sc backup after validation and confirmation.
  const handleImportVault = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('Backup file could not be read.');
        if (text.length > 50_000_000) throw new Error('Backup file is too large.');
        const header = JSON.parse(text) as { version?: unknown };

        setPendingLegacyBackup(null);
        if (header?.version === 2) {
          setPendingEncryptedBackup(parseEncryptedBackup(text));
          setBackupCredential('password');
          setBackupSecret('');
          setBackupDialog('import');
          return;
        }

        setPendingEncryptedBackup(null);
        setPendingLegacyBackup(parseBackup(text));
        setBackupCredential('password');
        setBackupSecret('');
        setBackupDialog('import');
      } catch (err: unknown) {
        alert(`Import failed: ${getErrorMessage(err)}`);
      }
    };
    reader.readAsText(file);
  };

  // Create and open [SC]
  const handleProvisionVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupPassword.length < 8) return setStatus('Password must be at least 8 characters.');
    if (!isValidCitizenInitials(setupInitials)) return setStatus('Enter exactly two letters for your [SC] signature.');
    if (!seedConfirmed) return setStatus('Confirm seed phrase backup.');

    try {
      const salt = generateSaltHex();
      const mek = await generateMasterKey();

      const wrappedMEKByPassword = await wrapMasterKey(mek, setupPassword, salt);
      const wrappedMEKBySeed = await wrapMasterKey(mek, generatedSeed.join(' '), salt);
      const encryptedSignature = await encryptData(setupInitials, mek);

      await db.vaultConfig.add({
        salt,
        wrappedMEKByPassword,
        wrappedMEKBySeed,
        encryptedSignature,
        createdAt: Date.now(),
      });

      setMasterKey(mek);
      setCitizenInitials(setupInitials);
      setInitialsDraft(setupInitials);
      recoveryPhraseCleared.current = true;
      setGeneratedSeed([]);
      setSeedConfirmed(false);
      setSetupPassword('');
      setStatus('[SC] created.');
    } catch (err: unknown) {
      setStatus(`Provisioning failed: ${getErrorMessage(err)}`);
    }
  };

  // Open an existing [SC] with its password
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultConfig) return;

    try {
      const mek = await unwrapMasterKey(vaultConfig.wrappedMEKByPassword, mainPassword, vaultConfig.salt);
      setMasterKey(mek);
      await loadSignature(mek, vaultConfig.encryptedSignature);
      setStatus(vaultConfig.encryptedSignature ? '[SC] opened.' : '[SC] opened. Add a two-letter signature.');
    } catch {
      setStatus('Invalid password.');
    }
  };

  // Restore access with the recovery phrase
  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultConfig?.id) return;
    if (newPassword.length < 8) return setStatus('New password must be at least 8 characters.');

    const seedWords = recoverySeedInput.trim().toLowerCase().split(/\s+/);
    const isValid = await validateBip39Seed(seedWords);
    if (!isValid) return setStatus('Invalid 24-word seed phrase or checksum failed.');

    try {
      const seedString = seedWords.join(' ');
      const mek = await unwrapMasterKey(vaultConfig.wrappedMEKBySeed, seedString, vaultConfig.salt);

      const newSalt = generateSaltHex();
      const newWrappedMEKByPassword = await wrapMasterKey(mek, newPassword, newSalt);
      const newWrappedMEKBySeed = await wrapMasterKey(mek, seedString, newSalt);

      await db.vaultConfig.update(vaultConfig.id, {
        salt: newSalt,
        wrappedMEKByPassword: newWrappedMEKByPassword,
        wrappedMEKBySeed: newWrappedMEKBySeed,
        encryptedSignature: vaultConfig.encryptedSignature,
      });

      setMasterKey(mek);
      await loadSignature(mek, vaultConfig.encryptedSignature);
      setStatus('Access restored and password changed.');
    } catch {
      setStatus('Recovery phrase did not open [SC]. Check the words and try again.');
    }
  };

  // Verify credentials before changing the signature or password.
  const handleSaveInitials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterKey || !vaultConfig?.id) return;

    const normalizedInitials = normalizeCitizenInitials(initialsDraft);
    if (!isValidCitizenInitials(normalizedInitials)) {
      setStatus('Enter exactly two letters for your [SC] signature.');
      return;
    }
    if (!passwordForSignature || !vaultConfig) {
      setStatus('Enter your current password to update your signature.');
      return;
    }

    try {
      await unwrapMasterKey(vaultConfig.wrappedMEKByPassword, passwordForSignature, vaultConfig.salt);
      const encryptedSignature = await encryptData(normalizedInitials, masterKey);
      await db.vaultConfig.update(vaultConfig.id, { encryptedSignature });
      setCitizenInitials(normalizedInitials);
      setInitialsDraft(normalizedInitials);
      setPasswordForSignature('');
      setStatus('[SC] signature updated. New entries will use these initials.');
    } catch (err: unknown) {
      setStatus(err instanceof DOMException && err.name === 'OperationError'
        ? 'Signature update failed. Check your current password and try again.'
        : 'Signature update failed. Please try again.');
    }
  };

  // Change the login password; the recovery phrase keeps working
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterKey || !vaultConfig?.id) return;
    if (replacementPassword.length < 8) return setStatus('The new password must contain at least 8 characters.');
    if (replacementPassword !== confirmReplacementPassword) return setStatus('The new passwords do not match.');

    try {
      await unwrapMasterKey(vaultConfig.wrappedMEKByPassword, currentPasswordForChange, vaultConfig.salt);
      const wrappedMEKByPassword = await wrapMasterKey(masterKey, replacementPassword, vaultConfig.salt);
      await db.vaultConfig.update(vaultConfig.id, { wrappedMEKByPassword });
      setMainPassword(replacementPassword);
      setCurrentPasswordForChange('');
      setReplacementPassword('');
      setConfirmReplacementPassword('');
      setStatus('Password changed. Your recovery phrase remains valid.');
    } catch {
      setStatus('Password change failed. Check the current password and try again.');
    }
  };

  // Entry writing and reading
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterKey || !entryTitle || !entryCatalyst || !entryFriction || !entryParameter || !isValidCitizenInitials(citizenInitials)) {
      setStatus('An [SC] entry requires your two-letter signature, a title, and all three Iterative Formula fields.');
      return;
    }

    try {
      const canonicalEntry = serializeCodexEntry({
        title: entryTitle,
        sequence: entrySequence,
        signature: citizenInitials,
        catalyst: entryCatalyst,
        friction: entryFriction,
        parameter: entryParameter,
        notes: entryNotes,
      });

      const encryptedPayload = await encryptData(canonicalEntry, masterKey);
      await db.entries.add({
        title: entryTitle,
        category: 'Iterative Codex Entry',
        tags: ['codex', 'iterative', 'encrypted'],
        isEncrypted: true,
        content: encryptedPayload,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      setEntryTitle('');
      setEntrySequence('A');
      setEntryCatalyst('');
      setEntryFriction('');
      setEntryParameter('');
      setEntryNotes('');
      setStatus('[SC] entry saved.');
    } catch (err: unknown) {
      setStatus(`Save failed: ${getErrorMessage(err)}`);
    }
  };

  // Decrypt one entry for display on demand
  const handleDecryptRecord = async (entry: EntryRecord) => {
    if (!entry.id || !masterKey || typeof entry.content !== 'string') return;
    try {
      const plaintext = await decryptData(entry.content, masterKey);
      setDecryptedRecords((prev) => ({ ...prev, [entry.id!]: plaintext }));
    } catch {
      setStatus('Decryption failed.');
    }
  };

  return (
    <main className="min-h-screen bg-[#090a0f] text-[#e0e6ed] p-6 mx-auto space-y-8 font-sans max-w-4xl">
      {/* Brand, backup, and session controls */}
      <header className="app-header space-y-3 border-b border-[#202530] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold text-[#E5C158] font-mono sm:text-2xl">[SC] [SOVEREIGN CODEX]</h1>
            <p className="text-xs text-gray-400">The Application</p>
          </div>
          {status && (
            <span className="text-xs bg-[#141822] px-3 py-1.5 rounded border border-[#252b3b] font-mono hidden sm:inline-block">
              {status}
            </span>
          )}
        </div>

        <div className="app-header__actions">
          {/* Export .sc File */}
          {vaultConfig && (
            <button
              onClick={handleExportVault}
              disabled={!masterKey}
              className="app-header__action text-xs bg-[#1c2230] hover:bg-[#283144] text-[#E5C158] rounded border border-[#2e374d] transition disabled:cursor-not-allowed disabled:opacity-40"
              title={masterKey ? 'Export an encrypted portable .sc backup of [SC]' : 'Unlock [SC] to create an encrypted backup'}
            >
              Export .sc backup
            </button>
          )}

          {/* Import .sc File */}
          <label className="app-header__action text-xs bg-[#1c2230] hover:bg-[#283144] text-gray-300 rounded border border-[#2e374d] transition cursor-pointer">
            Import .sc backup
            <input type="file" accept=".sc,.json" onChange={handleImportVault} className="hidden" />
          </label>

          {/* Lock Session Button */}
          {masterKey && (
            <button
              onClick={() => {
                setMasterKey(null);
                setCitizenInitials('');
                setInitialsDraft('');
                setCurrentPasswordForChange('');
                setReplacementPassword('');
                setConfirmReplacementPassword('');
                setPasswordForSignature('');
                setStatus('[SC] locked.');
              }}
              className="app-header__action text-xs bg-[#1c2230] hover:bg-[#283144] text-gray-300 rounded border border-[#2e374d] transition"
            >
              Lock [SC]
            </button>
          )}

          {/* Reset / Purge Vault Button */}
          <button
            onClick={handleFactoryReset}
            className="app-header__action text-xs bg-red-950/40 hover:bg-red-900/60 text-red-300 rounded border border-red-800/50 transition"
          >
            Erase local [SC]
          </button>
        </div>
      </header>

      {/* Read / Write tab switch */}
      <nav aria-label="[SC] sections" className="flex border-b border-[#202530] text-xs">
        <button
          type="button"
          onClick={() => setActiveSection('archive')}
          aria-pressed={activeSection === 'archive'}
          className={`px-4 py-2 font-bold ${activeSection === 'archive' ? 'border-b-2 border-[#E5C158] text-[#E5C158]' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Read
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('writing')}
          aria-pressed={activeSection === 'writing'}
          className={`px-4 py-2 font-bold ${activeSection === 'writing' ? 'border-b-2 border-[#E5C158] text-[#E5C158]' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Write
        </button>
      </nav>

      {/* Read tab: lazy-loaded so the markdown stack loads only when needed */}
      {activeSection === 'archive' && (
        <Suspense fallback={<p role="status" className="text-sm text-gray-400">Opening archive reader…</p>}>
          <ArchiveReader onBeginEntry={beginEntry} />
        </Suspense>
      )}

      {/* New [SC] setup */}
      {activeSection === 'writing' && !vaultConfig && (
        <section id="sc-write-start" tabIndex={-1} className="sc-cover-frame sc-cover-frame--write bg-[#11141d] p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-[#E5C158]">Create your [SOVEREIGN CODEX]</h2>
            <label className="text-xs text-[#E5C158] underline cursor-pointer">
              Or restore from a .sc backup
              <input type="file" accept=".sc,.json" onChange={handleImportVault} className="hidden" />
            </label>
          </div>
          <p className="text-xs text-gray-400">
            Keep these 24 words offline and in order. They restore access if you cannot use your password.
          </p>
          
          {/* 24-Word Seed Phrase Grid */}
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2 bg-[#090a0f] p-4 rounded border border-[#202530] font-mono text-xs text-[#E5C158]">
            {generatedSeed.map((word, idx) => (
              <div key={idx} className="flex gap-1.5 bg-[#141822] px-2 py-1 rounded border border-[#202530]">
                <span className="text-gray-600 font-bold">{idx + 1}.</span>
                <span>{word}</span>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seedConfirmed}
              onChange={(e) => setSeedConfirmed(e.target.checked)}
              className="accent-[#E5C158]"
            />
            <span className="text-xs text-gray-300">I have stored my 24-word recovery phrase offline.</span>
          </label>

          <form onSubmit={handleProvisionVault} className="space-y-4 pt-4 border-t border-[#202530]">
            <label className="block space-y-2 text-xs text-gray-300">
              <span className="font-bold uppercase text-[#E5C158]">Citizen Signature</span>
              <span className="block text-[11px] text-gray-400">Two letters for your [SC] index identifier.</span>
              <input
                type="text"
                value={setupInitials}
                onChange={(e) => setSetupInitials(normalizeCitizenInitials(e.target.value))}
                maxLength={2}
                autoCapitalize="characters"
                autoComplete="off"
                aria-label="Two-letter Citizen signature"
                placeholder="[ _ _ ]"
                className="w-full max-w-32 bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm font-mono uppercase text-white focus:outline-none focus:border-[#E5C158]"
              />
            </label>
            <input
              type="password"
              placeholder="Set Main Password (min. 8 characters)..."
              value={setupPassword}
              onChange={(e) => setSetupPassword(e.target.value)}
              className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
            />
            <button
              type="submit"
              disabled={!seedConfirmed || setupPassword.length < 8 || !isValidCitizenInitials(setupInitials)}
              className="w-full bg-[#E5C158] hover:bg-[#d4b04d] disabled:opacity-40 disabled:cursor-not-allowed text-[#090a0f] font-bold text-xs py-3 rounded uppercase transition"
            >
              Create [SC]
            </button>
          </form>
        </section>
      )}

      {/* Locked [SC]: password access or recovery phrase */}
      {activeSection === 'writing' && vaultConfig && !masterKey && (
        <section id="sc-write-start" tabIndex={-1} className="sc-cover-frame sc-cover-frame--write bg-[#11141d] p-6 max-w-md mx-auto space-y-4">
          <div className="flex border-b border-[#202530] text-xs">
            <button
              onClick={() => setActiveTab('unlock')}
              className={`flex-1 py-2 font-bold ${activeTab === 'unlock' ? 'text-[#E5C158] border-b-2 border-[#E5C158]' : 'text-gray-400'}`}
            >
              Password
            </button>
            <button
              onClick={() => setActiveTab('recover')}
              className={`flex-1 py-2 font-bold ${activeTab === 'recover' ? 'text-[#E5C158] border-b-2 border-[#E5C158]' : 'text-gray-400'}`}
            >
              Recovery phrase
            </button>
          </div>

          {activeTab === 'unlock' ? (
            <form onSubmit={handleUnlock} className="space-y-4">
              <input
                type="password"
                placeholder="Enter password"
                value={mainPassword}
                onChange={(e) => setMainPassword(e.target.value)}
                className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
              />
              <button type="submit" className="w-full bg-[#E5C158] text-[#090a0f] font-bold text-xs py-2.5 rounded uppercase">
                Open [SC]
              </button>
            </form>
          ) : (
            <form onSubmit={handleRecovery} className="space-y-4">
              <textarea
                placeholder="Enter your 24-word recovery phrase"
                rows={4}
                value={recoverySeedInput}
                onChange={(e) => setRecoverySeedInput(e.target.value)}
                className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-[#E5C158]"
              />
              <input
                type="password"
                placeholder="Choose a new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
              />
              <button type="submit" className="w-full bg-[#E5C158] text-[#090a0f] font-bold text-xs py-2.5 rounded uppercase">
                Restore access
              </button>
            </form>
          )}

          {/* Emergency Option on Lock Screen */}
          <div className="pt-4 border-t border-[#202530] text-center space-y-2">
            <label className="block text-[11px] text-[#E5C158] underline cursor-pointer">
              Have a .sc backup? Open it here
              <input type="file" accept=".sc,.json" onChange={handleImportVault} className="hidden" />
            </label>
            <button
              onClick={handleFactoryReset}
              className="text-[11px] text-red-400/80 hover:text-red-300 underline transition"
            >
              Cannot access [SC]? Erase its local data
            </button>
          </div>
        </section>
      )}

      {/* Open [SC]: credentials, entry writing, and archive reading */}
      {activeSection === 'writing' && masterKey && (
        <div id="sc-write-start" tabIndex={-1} className="sc-cover-frame sc-cover-frame--write space-y-8 p-4">
          {/* Change password and edit signature */}
          <details className="border-b border-[#202530] pb-3 text-xs">
            <summary className="cursor-pointer select-none text-gray-400 hover:text-[#E5C158]">
              [SC] access & signature <span className="ml-2 font-mono text-gray-500">[{citizenInitials || '__'}]</span>
            </summary>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <form onSubmit={handleChangePassword} className="space-y-3">
                <h2 className="font-bold uppercase tracking-wider text-[#E5C158]">Change password</h2>
                <input
                  type="password"
                  value={currentPasswordForChange}
                  onChange={(e) => setCurrentPasswordForChange(e.target.value)}
                  autoComplete="current-password"
                  aria-label="Current password to verify password change"
                  placeholder="Current password"
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
                />
                <input
                  type="password"
                  value={replacementPassword}
                  onChange={(e) => setReplacementPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-label="New password"
                  placeholder="New password (at least 8 characters)"
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
                />
                <input
                  type="password"
                  value={confirmReplacementPassword}
                  onChange={(e) => setConfirmReplacementPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-label="Confirm new password"
                  placeholder="Confirm new password"
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
                />
                <button
                  type="submit"
                  disabled={!currentPasswordForChange || replacementPassword.length < 8 || replacementPassword !== confirmReplacementPassword}
                  className="border border-[#2e374d] bg-[#1c2230] px-3 py-2 font-semibold text-[#E5C158] transition hover:bg-[#283144] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Change password
                </button>
              </form>

              <form onSubmit={handleSaveInitials} className="space-y-3">
                <h2 className="font-bold uppercase tracking-wider text-[#E5C158]">[SC] signature</h2>
                <p className="text-gray-400">Two letters identify new entries. Existing entries keep their original signature.</p>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-gray-400">[</span>
                  <input
                    type="text"
                    value={initialsDraft}
                    onChange={(e) => setInitialsDraft(normalizeCitizenInitials(e.target.value))}
                    maxLength={2}
                    autoCapitalize="characters"
                    autoComplete="off"
                    aria-label="Edit two-letter Citizen signature"
                    placeholder="__"
                    className="w-20 bg-[#090a0f] border border-[#2b3245] rounded px-3 py-2 text-sm font-mono uppercase text-white focus:outline-none focus:border-[#E5C158]"
                  />
                  <span className="font-mono text-gray-400">]</span>
                </div>
                <input
                  type="password"
                  value={passwordForSignature}
                  onChange={(e) => setPasswordForSignature(e.target.value)}
                  autoComplete="current-password"
                  aria-label="Current password to confirm signature change"
                  placeholder="Confirm with current password"
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
                />
                <button
                  type="submit"
                  disabled={!isValidCitizenInitials(initialsDraft) || initialsDraft === citizenInitials || !passwordForSignature}
                  className="border border-[#2e374d] bg-[#1c2230] px-3 py-2 font-semibold text-[#E5C158] transition hover:bg-[#283144] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Update signature
                </button>
              </form>
            </div>
          </details>

          {/* New entry form: Catalyst, Friction, Parameter */}
          <form onSubmit={handleSaveRecord} className="bg-[#11141d] p-5 rounded-lg border border-[#202530] space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#E5C158]">New [SC] Entry</h2>
              <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Catalyst → Friction → Parameter</span>
            </div>

            <input
              type="text"
              placeholder="Title"
              value={entryTitle}
              onChange={(e) => setEntryTitle(e.target.value)}
              className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-sm text-white"
            />

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setEntrySequence('A')}
                  className={`flex-1 rounded border px-3 py-2 text-left text-xs uppercase tracking-[0.2em] transition ${
                    entrySequence === 'A'
                      ? 'border-[#E5C158] bg-[#1d1a10] text-[#E5C158]'
                      : 'border-[#2b3245] bg-[#090a0f] text-gray-300'
                  }`}
                >
                  Sequence A | Reactive Template
                </button>
                <button
                  type="button"
                  onClick={() => setEntrySequence('B')}
                  className={`flex-1 rounded border px-3 py-2 text-left text-xs uppercase tracking-[0.2em] transition ${
                    entrySequence === 'B'
                      ? 'border-[#E5C158] bg-[#1d1a10] text-[#E5C158]'
                      : 'border-[#2b3245] bg-[#090a0f] text-gray-300'
                  }`}
                >
                  Sequence B | Proactive Template
                </button>
              </div>

              <div className="rounded border border-[#2b3245] bg-[#090a0f] p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#E5C158]">
                  {getSequenceLabel(entrySequence)}
                </div>
                <p className="text-xs leading-relaxed text-gray-300">{sequenceGuidance.overview}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-xs text-gray-300">
                <span className="font-bold uppercase text-[#E5C158]">The Catalyst</span>
                <span className="block text-[10px] uppercase tracking-[0.15em] text-gray-400">
                  {sequenceGuidance.catalyst}
                </span>
                <span className="block text-[10px] leading-relaxed text-gray-500">{sequenceGuidance.catalystExecution}</span>
                <textarea
                  rows={4}
                  placeholder="The Catalyst"
                  value={entryCatalyst}
                  onChange={(e) => setEntryCatalyst(e.target.value)}
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-sm text-white"
                />
              </label>

              <label className="space-y-2 text-xs text-gray-300">
                <span className="font-bold uppercase text-[#E5C158]">The Friction</span>
                <span className="block text-[10px] uppercase tracking-[0.15em] text-gray-400">
                  {sequenceGuidance.friction}
                </span>
                <span className="block text-[10px] leading-relaxed text-gray-500">{sequenceGuidance.frictionExecution}</span>
                <textarea
                  rows={4}
                  placeholder="The Friction"
                  value={entryFriction}
                  onChange={(e) => setEntryFriction(e.target.value)}
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-sm text-white"
                />
              </label>

              <label className="space-y-2 text-xs text-gray-300">
                <span className="font-bold uppercase text-[#E5C158]">The Parameter</span>
                <span className="block text-[10px] uppercase tracking-[0.15em] text-gray-400">
                  {sequenceGuidance.parameter}
                </span>
                <span className="block text-[10px] leading-relaxed text-gray-500">{sequenceGuidance.parameterExecution}</span>
                <textarea
                  rows={4}
                  placeholder="The Parameter"
                  value={entryParameter}
                  onChange={(e) => setEntryParameter(e.target.value)}
                  className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-sm text-white"
                />
              </label>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-gray-300">
                <span className="font-bold uppercase text-[#E5C158]">Notes</span>
              </label>
              <textarea
                placeholder="Notes"
                rows={3}
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                className="w-full bg-[#090a0f] border border-[#2b3245] rounded p-2 text-sm text-white"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="w-full max-w-xs rounded border border-[#2b3245] bg-[#090a0f] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[#E5C158]">
                [PROTOCOL 03: ITERATIVE FORMULA]
              </div>

              <button type="submit" className="bg-[#E5C158] text-[#090a0f] font-semibold text-xs px-4 py-2 rounded">
                Save entry
              </button>
            </div>

            <div className="rounded border border-[#2c3321] bg-[#14180d] p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#E5C158] mb-2">Entry preview</p>
              <div className="space-y-1 text-xs text-gray-300 font-mono">
                {buildCodexPreview({ title: entryTitle, sequence: entrySequence, signature: citizenInitials, catalyst: entryCatalyst, friction: entryFriction, parameter: entryParameter, notes: entryNotes }).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          </form>

          {/* Saved entries; contents stay encrypted until opened */}
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              [SC] Entries ({entries?.length || 0})
            </h2>
            <p className="text-[11px] text-gray-500">Entry contents are encrypted. Titles and archive details remain readable for indexing.</p>
            <div className="grid gap-3">
              {entries?.map((entry) => {
                const decryptedContent = entry.id ? decryptedRecords[entry.id] : undefined;
                const parsedEntry = decryptedContent ? parseCodexEntry(decryptedContent) : null;

                return (
                  <div key={entry.id} className="bg-[#11141d] p-4 rounded border border-[#202530] space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-white">{entry.title}</span>
                      <span className="text-[10px] bg-amber-950 text-amber-400 border border-amber-800 px-2 py-0.5 rounded font-mono">
                        Encrypted entry
                      </span>
                    </div>
                    {parsedEntry ? (
                      <div className="rounded border border-[#42391c] bg-[#1a180e] p-3 space-y-3 text-sm text-[#f5ead1]">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#42391c] pb-2">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-[#E5C158]">Archive Reader</span>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.15em] text-gray-400">
                            <span>{parsedEntry.protocol}</span>
                            <span>Signature: [{parsedEntry.signature ?? '__'}]</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Title</div>
                          <div className="text-base font-semibold text-white">{parsedEntry.title}</div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Sequence</div>
                          <div className="text-sm text-[#E5C158]">{parsedEntry.sequenceLabel}</div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          {[
                            ['Catalyst', parsedEntry.catalyst],
                            ['Friction', parsedEntry.friction],
                            ['Parameter', parsedEntry.parameter],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded border border-[#2b3245] bg-[#090a0f] p-3">
                              <div className="text-[10px] uppercase tracking-[0.2em] text-[#E5C158] mb-2">{label}</div>
                              <div className="text-sm text-gray-200 whitespace-pre-wrap">{value}</div>
                            </div>
                          ))}
                        </div>

                        {parsedEntry.notes && (
                          <div className="space-y-2">
                            <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Notes</div>
                            <div className="text-sm text-gray-200 whitespace-pre-wrap">{parsedEntry.notes}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => handleDecryptRecord(entry)} className="text-xs text-[#E5C158] underline">
                        Open entry
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Optional source link (set by VITE_GITHUB_REPOSITORY_URL) */}
      {sourceRepositoryUrl && (
        <footer className="border-t border-[#202530] pt-4 text-right">
          <a
            href={sourceRepositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-gray-500 underline decoration-gray-700 underline-offset-4 transition hover:text-[#E5C158]"
          >
            View source code
          </a>
        </footer>
      )}

      {backupDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-dialog-title"
            className="w-full max-w-md border border-[#3b4252] bg-[#11141d] p-5 shadow-2xl"
          >
            <h2 id="backup-dialog-title" className="text-base font-bold text-[#E5C158]">
              {backupDialog === 'export'
                ? 'Encrypt [SC] backup'
                : pendingLegacyBackup ? 'Open legacy [SC] backup' : 'Open encrypted [SC] backup'}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              {backupDialog === 'export'
                ? 'Confirm the current [SC] password. The complete backup payload will be encrypted before download.'
                : pendingLegacyBackup
                  ? 'This version does not encrypt all metadata. Confirm its password or recovery phrase; local data changes only after credential validation and confirmation.'
                  : 'Choose the credential used to unlock this backup. Nothing in local storage changes until decryption and validation succeed.'}
            </p>

            <form onSubmit={backupDialog === 'export' ? downloadBackup : handleEncryptedBackupImport} className="mt-5 space-y-4">
              {backupDialog === 'import' && (
                <div className="flex border-b border-[#202530] text-xs">
                  <button
                    type="button"
                    onClick={() => { setBackupCredential('password'); setBackupSecret(''); }}
                    aria-pressed={backupCredential === 'password'}
                    className={`flex-1 py-2 font-bold ${backupCredential === 'password' ? 'border-b-2 border-[#E5C158] text-[#E5C158]' : 'text-gray-400'}`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBackupCredential('recoveryPhrase'); setBackupSecret(''); }}
                    aria-pressed={backupCredential === 'recoveryPhrase'}
                    className={`flex-1 py-2 font-bold ${backupCredential === 'recoveryPhrase' ? 'border-b-2 border-[#E5C158] text-[#E5C158]' : 'text-gray-400'}`}
                  >
                    Recovery phrase
                  </button>
                </div>
              )}

              {backupDialog === 'import' && backupCredential === 'recoveryPhrase' ? (
                <textarea
                  autoFocus
                  rows={4}
                  autoComplete="off"
                  aria-label="Backup recovery phrase"
                  placeholder="Enter the 24-word recovery phrase"
                  value={backupSecret}
                  onChange={(e) => setBackupSecret(e.target.value)}
                  className="w-full resize-y border border-[#2b3245] bg-[#090a0f] p-2 text-xs font-mono text-white focus:outline-none focus:border-[#E5C158]"
                />
              ) : (
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  aria-label={backupDialog === 'export' ? 'Current [SC] password for backup' : 'Backup password'}
                  placeholder={backupDialog === 'export' ? 'Current [SC] password' : 'Backup password'}
                  value={backupSecret}
                  onChange={(e) => setBackupSecret(e.target.value)}
                  className="w-full border border-[#2b3245] bg-[#090a0f] p-2.5 text-sm text-white focus:outline-none focus:border-[#E5C158]"
                />
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setBackupDialog(null);
                    setBackupSecret('');
                    setPendingEncryptedBackup(null);
                    setPendingLegacyBackup(null);
                    setReturnToImportAfterExport(false);
                  }}
                  className="border border-[#2e374d] px-3 py-2 text-xs text-gray-300 hover:bg-[#1c2230]"
                >
                  Cancel
                </button>
                {backupDialog === 'import' && vaultConfig && (
                  <button
                    type="button"
                    disabled={!masterKey || backupBusy}
                    onClick={() => {
                      setReturnToImportAfterExport(true);
                      setBackupDialog('export');
                      setBackupSecret('');
                    }}
                    className="border border-[#2e374d] px-3 py-2 text-xs text-[#E5C158] hover:bg-[#1c2230] disabled:cursor-not-allowed disabled:opacity-40"
                    title={!masterKey ? 'Unlock [SC] to export its current contents first' : 'Download an encrypted backup before replacing local data'}
                  >
                    Export current first
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!backupSecret.trim() || backupBusy}
                  className="bg-[#E5C158] px-3 py-2 text-xs font-bold text-[#090a0f] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {backupBusy ? 'Working…' : backupDialog === 'export' ? 'Encrypt and download' : 'Decrypt and open'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
