"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import React from "react";

export type Locale = "en" | "es" | "de" | "fr" | "pt" | "ja" | "zh" | "ru";

const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {
    "nav.overview": "Overview", "nav.servers": "Servers", "nav.files": "File Manager",
    "nav.rcon": "RCON Console", "nav.nodes": "Nodes", "nav.games": "Games",
    "nav.audit": "Audit", "nav.monitor": "Monitor", "nav.forum": "Forum",
    "nav.cms": "CMS", "nav.users": "Users", "nav.roles": "Roles",
    "nav.database": "Database", "nav.profile": "My Profile", "nav.scheduler": "Scheduler",
    "nav.apikeys": "API Keys", "nav.activity": "Activity Log",
    "section.main": "Management", "section.community": "Community",
    "section.admin": "Administration", "section.account": "Account",
    "action.start": "Start", "action.stop": "Stop", "action.restart": "Restart",
    "action.install": "Install", "action.delete": "Delete", "action.save": "Save",
    "action.cancel": "Cancel", "action.create": "Create", "action.edit": "Edit",
    "action.logout": "Logout", "action.login": "Sign In", "action.register": "Register",
    "status.running": "Running", "status.stopped": "Stopped",
    "status.installing": "Installing", "status.install_failed": "Install Failed",
    "common.servers": "servers", "common.online": "online", "common.loading": "Loading...",
    "common.search": "Search...", "common.noResults": "No results found",
    "common.welcome": "Welcome back", "common.confirm": "Confirm",
  },
  es: {
    "nav.overview": "Resumen", "nav.servers": "Servidores", "nav.files": "Archivos",
    "nav.rcon": "Consola RCON", "nav.nodes": "Nodos", "nav.games": "Juegos",
    "nav.audit": "Auditoría", "nav.monitor": "Monitor", "nav.forum": "Foro",
    "nav.cms": "CMS", "nav.users": "Usuarios", "nav.roles": "Roles",
    "nav.database": "Base de datos", "nav.profile": "Mi Perfil", "nav.scheduler": "Programador",
    "nav.apikeys": "Claves API", "nav.activity": "Registro de actividad",
    "section.main": "Gestión", "section.community": "Comunidad",
    "section.admin": "Administración", "section.account": "Cuenta",
    "action.start": "Iniciar", "action.stop": "Detener", "action.restart": "Reiniciar",
    "action.install": "Instalar", "action.delete": "Eliminar", "action.save": "Guardar",
    "action.cancel": "Cancelar", "action.create": "Crear", "action.edit": "Editar",
    "action.logout": "Cerrar sesión", "action.login": "Iniciar sesión", "action.register": "Registrarse",
    "status.running": "En ejecución", "status.stopped": "Detenido",
    "status.installing": "Instalando", "status.install_failed": "Instalación fallida",
    "common.servers": "servidores", "common.online": "en línea", "common.loading": "Cargando...",
    "common.search": "Buscar...", "common.noResults": "Sin resultados",
    "common.welcome": "Bienvenido", "common.confirm": "Confirmar",
  },
  de: {
    "nav.overview": "Übersicht", "nav.servers": "Server", "nav.files": "Dateien",
    "nav.rcon": "RCON-Konsole", "nav.nodes": "Knoten", "nav.games": "Spiele",
    "nav.monitor": "Monitor", "nav.forum": "Forum", "nav.users": "Benutzer",
    "nav.profile": "Mein Profil", "nav.scheduler": "Planer", "nav.apikeys": "API-Schlüssel",
    "section.main": "Verwaltung", "section.community": "Gemeinschaft",
    "section.admin": "Administration", "section.account": "Konto",
    "action.start": "Starten", "action.stop": "Stoppen", "action.restart": "Neustarten",
    "action.install": "Installieren", "action.delete": "Löschen", "action.save": "Speichern",
    "action.cancel": "Abbrechen", "action.create": "Erstellen", "action.logout": "Abmelden",
    "common.welcome": "Willkommen zurück", "common.loading": "Laden...",
  },
  fr: {
    "nav.overview": "Aperçu", "nav.servers": "Serveurs", "nav.files": "Fichiers",
    "nav.nodes": "Nœuds", "nav.games": "Jeux", "nav.monitor": "Moniteur",
    "nav.forum": "Forum", "nav.users": "Utilisateurs", "nav.profile": "Mon profil",
    "section.main": "Gestion", "section.community": "Communauté",
    "section.admin": "Administration", "section.account": "Compte",
    "action.start": "Démarrer", "action.stop": "Arrêter", "action.restart": "Redémarrer",
    "action.install": "Installer", "action.delete": "Supprimer", "action.save": "Enregistrer",
    "action.cancel": "Annuler", "action.create": "Créer", "action.logout": "Déconnexion",
    "common.welcome": "Bienvenue", "common.loading": "Chargement...",
  },
  pt: { "nav.overview": "Visão geral", "nav.servers": "Servidores", "action.start": "Iniciar", "action.stop": "Parar", "common.welcome": "Bem-vindo", "common.loading": "Carregando..." },
  ja: { "nav.overview": "概要", "nav.servers": "サーバー", "action.start": "開始", "action.stop": "停止", "common.welcome": "おかえりなさい", "common.loading": "読み込み中..." },
  zh: { "nav.overview": "概览", "nav.servers": "服务器", "action.start": "启动", "action.stop": "停止", "common.welcome": "欢迎回来", "common.loading": "加载中..." },
  ru: { "nav.overview": "Обзор", "nav.servers": "Серверы", "action.start": "Запустить", "action.stop": "Остановить", "common.welcome": "С возвращением", "common.loading": "Загрузка..." },
};

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English", es: "Español", de: "Deutsch", fr: "Français",
  pt: "Português", ja: "日本語", zh: "中文", ru: "Русский",
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key: string, fallback?: string) => fallback || key,
});

export function useI18n() { return useContext(I18nContext); }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("gsm-locale") as Locale) || "en";
    }
    return "en";
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") localStorage.setItem("gsm-locale", l);
  }, []);

  const t = useCallback((key: string, fallback?: string): string => {
    return TRANSLATIONS[locale]?.[key] || TRANSLATIONS.en[key] || fallback || key;
  }, [locale]);

  return React.createElement(I18nContext.Provider, { value: { locale, setLocale, t } }, children);
}

export function LanguageSelector({ compact }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();

  if (compact) {
    return React.createElement("select", {
      value: locale,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setLocale(e.target.value as Locale),
      className: "px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-muted",
    }, Object.entries(LOCALE_NAMES).map(([code, name]) =>
      React.createElement("option", { key: code, value: code }, name)
    ));
  }

  return React.createElement("select", {
    value: locale,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setLocale(e.target.value as Locale),
    className: "px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm",
  }, Object.entries(LOCALE_NAMES).map(([code, name]) =>
    React.createElement("option", { key: code, value: code }, name)
  ));
}
