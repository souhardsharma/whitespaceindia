"use client";

import { useState, FormEvent } from "react";

type Source = "reports" | "landing";

interface Props {
  variant: "full" | "compact";
  source: Source;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SubscribeForm({ variant, source }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setErrorMsg("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    if (variant === "full" && !trimmedName) {
      setErrorMsg("Please enter your name.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          name: name.trim() || undefined,
          company: company.trim() || undefined,
          phone: phone.trim() || undefined,
          source,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || "Subscription failed. Please try again.");
      }
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Subscription failed. Please try again.");
      setStatus("error");
    }
  }

  if (variant === "compact") {
    if (status === "success") {
      return (
        <div
          className="bg-[#BD402C] text-white font-label uppercase tracking-[0.25em] text-[11px] py-4 px-6 flex items-center justify-between gap-6"
          role="status"
          aria-live="polite"
        >
          <span>You&apos;re on the list.</span>
          <span aria-hidden>✓</span>
        </div>
      );
    }
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email"
          aria-label="Email address"
          disabled={status === "sending"}
          className="w-full bg-[#fcf9f4] border border-[#1c1c19] text-[#1c1c19] placeholder:text-[#1c1c19]/40 font-body text-base px-5 py-6 focus:outline-none focus:border-[#BD402C] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="group bg-[#BD402C] text-white font-label uppercase tracking-[0.25em] text-[11px] py-4 px-6 flex justify-between items-center gap-6 hover:bg-[#1c1c19] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === "sending" ? "Sending" : "Notify me"}
          <svg width="16" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M0 6h22M16 1l5 5-5 5" />
          </svg>
        </button>
        {status === "error" && errorMsg && (
          <p role="alert" className="font-body text-xs text-[#BD402C]">
            {errorMsg}
          </p>
        )}
      </form>
    );
  }

  if (status === "success") {
    return (
      <div
        className="border border-[#1c1c19] bg-[#fcf9f4] px-8 md:px-10 py-10 md:py-12 flex flex-col items-center text-center"
        role="status"
        aria-live="polite"
      >
        <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#BD402C] mb-4">
          Subscribed
        </span>
        <div className="h-px w-12 bg-[#1c1c19]" />
        <span className="font-label text-xl md:text-2xl font-bold uppercase tracking-tighter text-[#1c1c19] mt-4">
          You&apos;re on the list
        </span>
        <p className="font-body text-sm md:text-base text-[#1c1c19]/70 italic mt-4 max-w-md leading-relaxed">
          We&apos;ll write when new reports ship.
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full bg-transparent text-[#1c1c19] border-0 border-b border-[#1c1c19] py-3 px-0 font-body text-sm focus:ring-0 focus:outline-none focus:border-[#BD402C] placeholder:text-[#1c1c19]/30 disabled:opacity-60";
  const labelCls =
    "font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/70 block mb-2";

  return (
    <form
      onSubmit={onSubmit}
      className="border border-[#1c1c19] bg-[#fcf9f4] px-8 md:px-10 py-8 md:py-10 w-full max-w-2xl"
      noValidate
    >
      <div className="flex items-baseline justify-between mb-6">
        <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
          Get Notified
        </span>
        <span className="font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19]/50">
          When new reports ship
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <div>
          <label htmlFor="sf-name" className={labelCls}>
            Name <span className="text-[#BD402C] normal-case tracking-normal">required</span>
          </label>
          <input
            id="sf-name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === "sending"}
            maxLength={100}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="sf-company" className={labelCls}>
            Company <span className="text-[#1c1c19]/40 normal-case tracking-normal italic">optional</span>
          </label>
          <input
            id="sf-company"
            type="text"
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={status === "sending"}
            maxLength={100}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="sf-phone" className={labelCls}>
            Phone <span className="text-[#1c1c19]/40 normal-case tracking-normal italic">optional</span>
          </label>
          <input
            id="sf-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={status === "sending"}
            maxLength={30}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="sf-email" className={labelCls}>
            Email <span className="text-[#BD402C] normal-case tracking-normal">required</span>
          </label>
          <input
            id="sf-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "sending"}
            maxLength={150}
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <p className="font-body text-xs text-[#1c1c19]/50 italic leading-relaxed max-w-sm">
          We&apos;ll only use this to send report updates. No spam, unsubscribe anytime.
        </p>
        <button
          type="submit"
          disabled={status === "sending"}
          className="self-start md:self-auto bg-[#BD402C] text-white font-label uppercase tracking-[0.25em] text-[11px] px-7 py-4 flex items-center gap-4 hover:bg-[#1c1c19] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === "sending" ? "Sending" : "Notify Me"}
          <svg width="16" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M0 6h22M16 1l5 5-5 5" />
          </svg>
        </button>
      </div>

      {status === "error" && errorMsg && (
        <p role="alert" className="font-body text-xs text-[#BD402C] mt-4">
          {errorMsg}
        </p>
      )}
    </form>
  );
}
