import React, { useEffect, useRef, useState, useCallback } from "react";
import { FiSend, FiPlus, FiSearch, FiX, FiChevronDown } from "react-icons/fi";
import api, { getChatAnswer, getChatStats } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import { Sparkles } from "lucide-react";

type ChatSource = { rank: number; vendor_name?: string; similarity?: number; content_excerpt?: string };
type ChatMessage = {
  id: string;
  sender: "user" | "assistant" | "error";
  text: string;
  time: string;
  sources?: ChatSource[];
  vendorName?: string | null;
};

const AIAssistant: React.FC = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [vendorError, setVendorError] = useState<string>("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedVendorName, setSelectedVendorName] = useState("");
  const [isLoadingVendors, setIsLoadingVendors] = useState(false);
  const [hasIndexedData, setHasIndexedData] = useState<boolean | null>(null); // null = loading, true/false = checked
  const { user } = useAuth();
  const { toast } = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const vendorsLoadedRef = useRef(false);

  const resolveUserId = () => {
    return user?.id || "";
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isTyping]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowVendorDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Check if user has any indexed data on mount
  useEffect(() => {
    const checkIndexedData = async () => {
      const effectiveUserId = resolveUserId();
      if (!effectiveUserId) return;

      try {
        const { data, response } = await getChatStats(effectiveUserId);
        if (response.ok) {
          setHasIndexedData(data.indexed > 0);
          if (data.indexed === 0) {
            console.log("[AIAssistant] No indexed data found. User needs to sync first.");
          }
        }
      } catch (e) {
        console.error("[AIAssistant] Failed to check indexed data:", e);
        setHasIndexedData(false);
      }
    };

    if (user?.id) {
      checkIndexedData();
    }
  }, [user?.id]);

  const loadVendors = useCallback(async (force = false) => {
    if (isLoadingVendors || (vendorsLoadedRef.current && !force)) {
      console.log('[AIAssistant] Skipping vendor load (already loaded or in progress)');
      return;
    }

    const effectiveUserId = resolveUserId();

    if (!effectiveUserId) {
      setVendorError("Missing user id");
      return;
    }

    if (!/^[a-f0-9]{24}$/i.test(effectiveUserId)) {
      setVendorError("Invalid User ID format");
      toast({
        description: "User ID must be a 24-char hex ObjectId.",
        variant: "destructive"
      });
      return;
    }

    setIsLoadingVendors(true);
    setVendorError("");

    try {
      const { data, response } = await api.getVendors(effectiveUserId);
      console.log("[AIAssistant] getVendors response status", response.status, "payload:", data);

      if (!response.ok) {
        const msg = (data as any).message || (data as any).details || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      const incoming = data.vendors || [];
      setVendors(incoming);
      vendorsLoadedRef.current = true;
      console.log("[AIAssistant] vendors stored in state count=", incoming.length, incoming);

      if (data.total === 0) {
        setVendorError("No vendor folders found");
        toast({
          description: "Sync emails first to create vendor folders.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      console.error("[AIAssistant] vendor load error", e);
      const errMsg = e.message || "Failed to load vendors";
      setVendorError(errMsg);
      vendorsLoadedRef.current = false;
      toast({
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setIsLoadingVendors(false);
    }
  }, [user?.id, isLoadingVendors, toast]);

  useEffect(() => {
    if (user?.id && !vendorsLoadedRef.current && !isLoadingVendors) {
      console.log('[AIAssistant] Triggering initial vendor load');
      loadVendors();
    }
  }, [user?.id, loadVendors]);

  const formatTime = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const pushMessage = (partial: Omit<ChatMessage, "id" | "time"> & { time?: string }) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: partial.time || formatTime(),
      ...partial,
    };
    setMessages((prev) => [...prev, msg]);
  };

  const handleSend = async () => {
    const value = input.trim();
    if (!value || isTyping) return;

    pushMessage({ sender: "user", text: value });
    setInput("");
    setIsTyping(true);

    try {
      const effectiveUserId = resolveUserId();
      const vendorToQuery = selectedVendorName && selectedVendorName !== 'ALL' ? selectedVendorName : undefined;
      const { data, response } = await getChatAnswer(value, vendorToQuery, effectiveUserId);
      
      if (!response.ok) {
        pushMessage({ sender: "error", text: (data as any).detail || data.message || `Error: HTTP ${response.status}` });
      } else if (data.success === false) {
        pushMessage({
          sender: "assistant",
          text: data.answer || data.message || "I couldn't find relevant data to answer your question.",
          sources: [],
          vendorName: data.vendor_name ?? null,
        });
      } else {
        // Check if answer contains quota/rate limit error
        const answer = data.answer || "";
        const isQuotaError = answer.includes("429") || answer.includes("quota") || answer.includes("rate-limit");
        
        pushMessage({
          sender: isQuotaError ? "error" : "assistant",
          text: isQuotaError 
            ? "⚠️ AI service quota exceeded. Please try again in a minute." 
            : (answer || "(No answer returned)"),
          sources: isQuotaError ? [] : (data.sources || []).map((s: any, idx: number) => ({
            rank: s.rank ?? idx + 1,
            vendor_name: s.vendor_name || s.vendor || data.vendor_name,
            similarity: s.similarity,
            content_excerpt: s.content_excerpt || s.chunk || s.text,
          })),
          vendorName: data.vendor_name ?? null,
        });
      }
    } catch (e: any) {
      pushMessage({ sender: "error", text: `Error: ${e.message}` });
    } finally {
      setIsTyping(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setIsTyping(false);
    setSearchQuery("");
    setIsSearchOpen(false);
  };

  const renderMessageText = (text: string, globalIndex: number) => {
    const urlRegex = /https?:\/\/[^\s)]+/g;
    const segments: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
      const urlStart = match.index;
      const urlEnd = urlRegex.lastIndex;
      const before = text.slice(lastIndex, urlStart);
      if (before) segments.push(applySearchHighlight(before, globalIndex));
      const url = match[0].replace(/[.,;!?)]$/,'');
      segments.push(
        <a
          key={`url-${urlStart}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-violet-400 hover:text-violet-300 break-all"
        >
          {url}
        </a>
      );
      lastIndex = urlEnd;
    }
    const tail = text.slice(lastIndex);
    if (tail) segments.push(applySearchHighlight(tail, globalIndex));
    return <>{segments}</>;
  };

  const applySearchHighlight = (text: string, globalIndex: number) => {
    const q = searchQuery.trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    const nodes: React.ReactNode[] = [];
    let idx = 0;
    let match = lower.indexOf(qLower);
    let occurrence = 0;
    while (match !== -1) {
      if (match > idx) nodes.push(text.slice(idx, match));
      const fragment = text.slice(match, match + q.length);
      const isActive = globalIndex === activeMatchIndex && occurrence === 0;
      nodes.push(
        <mark
          key={`hl-${match}-${occurrence}`}
          className={`rounded px-0.5 ${isActive ? 'bg-violet-500 text-white' : 'bg-violet-300/70 text-violet-900'}`}
        >{fragment}</mark>
      );
      idx = match + q.length;
      occurrence += 1;
      match = lower.indexOf(qLower, idx);
    }
    if (idx < text.length) nodes.push(text.slice(idx));
    return <>{nodes}</>;
  };

  const matchedMessageIndices = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => searchQuery.trim() && m.text.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(({ i }) => i);

  const totalMatches = matchedMessageIndices.length;

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  const grouped = useCallback(() => {
    const groups: { sender: ChatMessage["sender"]; items: ChatMessage[] }[] = [];
    for (const msg of messages) {
      const last = groups[groups.length - 1];
      if (last && last.sender === msg.sender) {
        last.items.push(msg);
      } else {
        groups.push({ sender: msg.sender, items: [msg] });
      }
    }
    return groups;
  }, [messages]);

  const handleVendorDropdownClick = () => {
    if (!vendors.length && !vendorError && !isLoadingVendors) {
      loadVendors();
    }
    setShowVendorDropdown(!showVendorDropdown);
  };

  const handleVendorSelect = (vendorId: string, vendorName: string) => {
    setSelectedVendorId(vendorId);
    setSelectedVendorName(vendorName);
    setShowVendorDropdown(false);
    // No API call here - just set the selection. Backend will handle filtering when user asks a question.
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-3 shadow-md flex-none">
        <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 mr-2" />
          <div>
            <h1 className="text-base font-semibold">Jarvis</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors"
            aria-label="Search"
          >
            <FiSearch className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors"
            aria-label="New chat"
          >
            <FiPlus className="h-5 w-5" />
          </button>
        </div>
      </header>

      {isSearchOpen && (
        <div className="flex-none px-6 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 max-w-4xl mx-auto">
            <FiSearch className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in conversation..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <span className="text-xs text-muted-foreground">
                {totalMatches} {totalMatches === 1 ? "result" : "results"}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition"
            >
              <FiX className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto py-8 space-y-6">
          {messages.length === 0 && !isTyping && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-primary">AI</span>
              </div>
              <h2 className="text-2xl font-semibold mb-2">How can I help you today?</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Ask questions about your vendors, invoices, and analytics
              </p>
              
              {/* Show sync warning if no indexed data */}
              {hasIndexedData === false && (
                <div className="mb-6 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    ⚠️ No indexed data found. Please sync your emails and process documents first.
                  </p>
                </div>
              )}
              
              {hasIndexedData && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                  {[
                    "Show invoice totals trend",
                    "List large invoices",
                    "Summarize vendor performance",
                    "Show monthly spend trend",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="text-left text-sm px-4 py-3 rounded-lg border hover:bg-muted transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              
              {!selectedVendorName && vendors.length > 0 && hasIndexedData && (
                <p className="text-sm text-muted-foreground mt-4">
                  Select a vendor below to filter, or ask questions across all vendors.
                </p>
              )}
            </div>
          )}

          {grouped().map((group, gi) => (
            <div key={gi} className={`flex ${group.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`flex gap-3 max-w-[85%] ${group.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                {group.sender !== "user" && (
                  <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-semibold text-primary">AI</span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {group.items
                    .filter(m => !searchQuery.trim() || m.text.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((m) => {
                      const globalIndex = messages.indexOf(m);
                      return (
                        <div
                          id={`msg-${globalIndex}`}
                          key={m.id}
                          className={`rounded-2xl px-4 py-2.5 text-sm ${
                            group.sender === "user"
                              ? "bg-primary text-primary-foreground"
                              : group.sender === "assistant"
                                ? "bg-muted"
                                : "bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200 border border-red-200 dark:border-red-800"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {renderMessageText(m.text, matchedMessageIndices.indexOf(globalIndex))}
                          </p>
                          {m.vendorName && group.sender === "assistant" && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Vendor: {m.vendorName}
                            </p>
                          )}
                          {m.sources && m.sources.length > 0 && (
                            <details className="mt-2 text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View sources ({m.sources.length})
                              </summary>
                              <div className="mt-2 space-y-1 pl-2">
                                {m.sources.map((source, idx) => (
                                  <div key={idx} className="text-muted-foreground">
                                    {source.vendor_name && <span className="font-medium">{source.vendor_name}</span>}
                                    {source.similarity && <span className="ml-2">({(source.similarity * 100).toFixed(0)}%)</span>}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="flex gap-3">
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary">AI</span>
                </div>
                <div className="rounded-2xl px-4 py-2.5 bg-muted">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      <div className="flex-none border-t bg-background px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative bg-muted rounded-2xl border shadow-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
            <div className="flex items-end gap-2 p-2">
              <div className="relative flex-shrink-0" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={handleVendorDropdownClick}
                  disabled={isLoadingVendors}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium hover:bg-background transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={selectedVendorName || "Select vendor"}
                >
                  <span className="max-w-[120px] truncate">
                    {isLoadingVendors ? "Loading..." : (selectedVendorName || "Select Vendors")}
                  </span>
                  <FiChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                
                {showVendorDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-background border rounded-lg shadow-lg overflow-hidden z-10">
                    <div className="max-h-64 overflow-y-auto p-1">
                      {isLoadingVendors ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Loading vendors...
                        </div>
                      ) : vendors.length === 0 ? (
                        <div className="px-3 py-2">
                          <p className="text-sm text-muted-foreground mb-2">
                            {vendorError || "No vendors found"}
                          </p>
                          {vendorError && (
                            <button
                              onClick={() => loadVendors(true)}
                              className="text-xs text-primary hover:underline"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleVendorSelect('', '')}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${
                              !selectedVendorName ? 'bg-primary text-primary-foreground' : ''
                            }`}
                          >
                            Select
                          </button>
                          {vendors.map(v => (
                            <button
                              key={v.id}
                              onClick={() => handleVendorSelect(v.id, v.name)}
                              className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${
                                selectedVendorId === v.id ? 'bg-primary text-primary-foreground' : ''
                              }`}
                            >
                              {v.name}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder={selectedVendorName ? `Ask about ${selectedVendorName}...` : "Ask anything about your vendors and invoices..."}
                className="flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground max-h-[200px]"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex-shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                aria-label="Send message"
              >
                <FiSend className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          <p className="mt-2 text-center text-xs text-muted-foreground">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;