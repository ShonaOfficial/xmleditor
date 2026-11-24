import React, { useEffect, useState } from 'react';
import { BadgeCheck, Save, X } from 'lucide-react';
import {
  applyTemplateIdentityToXml,
  parseTemplateIdentityFromXml,
  type TemplateIdentityInfo,
} from '../lib/templateIdentity';

interface TemplateIdentityModalProps {
  isOpen: boolean;
  xml: string;
  isDark?: boolean;
  onClose: () => void;
  onSaveXml: (nextXml: string, identity: TemplateIdentityInfo) => void;
}

export const TemplateIdentityModal: React.FC<TemplateIdentityModalProps> = ({
  isOpen,
  xml,
  isDark = false,
  onClose,
  onSaveXml,
}) => {
  const [form, setForm] = useState<TemplateIdentityInfo>(() => parseTemplateIdentityFromXml(xml));

  useEffect(() => {
    if (isOpen) {
      setForm(parseTemplateIdentityFromXml(xml));
    }
  }, [isOpen, xml]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextXml = applyTemplateIdentityToXml(xml, form);
    onSaveXml(nextXml, form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/55 p-0 sm:p-4">
      <div
        className={`w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border shadow-xl overflow-hidden ${
          isDark
            ? 'bg-slate-900 border-slate-700 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div
          className={`px-4 sm:px-5 py-3.5 border-b flex items-center justify-between gap-3 ${
            isDark ? 'border-slate-800' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <BadgeCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <h3 className="text-sm font-semibold truncate">Identitas Template Blogger XML</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pengaturan identitas template"
            className={`p-1 rounded cursor-pointer ${
              isDark
                ? 'text-slate-400 hover:text-slate-100'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="block text-[11px] font-medium opacity-80">Nama Template</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Mis. Shona Official"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:border-blue-600 ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-100'
                    : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium opacity-80">Versi</label>
              <input
                type="text"
                value={form.version}
                onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
                placeholder="1.0.0"
                className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:border-blue-600 ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-100'
                    : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium opacity-80">Author / Pembuat</label>
              <input
                type="text"
                value={form.author}
                onChange={(e) => setForm((prev) => ({ ...prev, author: e.target.value }))}
                placeholder="Shona Official"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:border-blue-600 ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-100'
                    : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium opacity-80">URL Author</label>
              <input
                type="url"
                value={form.authorUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, authorUrl: e.target.value }))}
                placeholder="https://example.com"
                className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:border-blue-600 ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-100'
                    : 'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium opacity-80">Lisensi</label>
            <input
              type="text"
              value={form.license}
              onChange={(e) => setForm((prev) => ({ ...prev, license: e.target.value }))}
              placeholder="Free / MIT / Premium"
              className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:border-blue-600 ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium opacity-80">Deskripsi Singkat</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Catatan deskripsi di blok header <b:skin>..."
              className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:border-blue-600 ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            />
          </div>

          <div
            className={`pt-3 border-t flex items-center justify-end gap-2 ${
              isDark ? 'border-slate-800' : 'border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border cursor-pointer ${
                isDark
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Batal
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan Identitas ke XML</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
