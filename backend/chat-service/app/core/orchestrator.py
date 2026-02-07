from typing import Dict, Any, List, Optional
from app.core.loader import VendorDataLoader
from app.core.embedder import EmbeddingService
from app.core.retriever import VectorDatabase
from app.core.llm_service import LLMService
from app.config import VENDOR_DATA_DIRECTORY, VECTORDB_PERSIST_DIRECTORY


class VendorKnowledgeOrchestrator:
    """Simplified orchestrator for RAG-based Q&A with user isolation."""
    
    def __init__(self, data_directory: str = VENDOR_DATA_DIRECTORY, vectordb_directory: str = VECTORDB_PERSIST_DIRECTORY):
        self.data_loader = VendorDataLoader(data_directory)
        self.embedding_service = EmbeddingService()
        self.vector_db = VectorDatabase(vectordb_directory)
        self.llm_service = LLMService(self.embedding_service, self.vector_db)

    def process_direct_dataset(self, dataset, user_id: str, incremental: bool = False) -> Dict[str, Any]:
        """Embed & store a pre-built VendorDataset with user_id."""
        try:
            if not dataset or not getattr(dataset, 'vendors', None):
                return {"success": False, "message": "Empty vendor dataset", "stats": {}}
            
            # Convert to chunks with user_id
            chunks = self.data_loader.convert_to_knowledge_chunks(dataset, user_id)
            
            if incremental:
                existing_ids = set(self.vector_db.list_ids())
                chunks = [c for c in chunks if c.chunk_id not in existing_ids]
            
            # Generate embeddings
            embedded_chunks = self.embedding_service.generate_embeddings(chunks)
            
            # Store in vector DB
            storage_success = self.vector_db.store_embeddings(embedded_chunks)
            db_stats = self.vector_db.get_collection_stats()
            
            return {
                "success": storage_success,
                "message": "Vendor dataset ingested successfully",
                "stats": db_stats,
                "chunks_processed": len(embedded_chunks),
                "incremental": incremental,
            }
        except Exception as e:
            return {"success": False, "message": f"Dataset ingestion failed: {e}", "stats": {}}

    def answer_query(self, question: str, user_id: str, vendor_name: str = None, n_results: int = 5) -> Dict[str, Any]:
        """Answer a question using RAG with user isolation."""
        try:
            # Generate question embedding
            query_embedding = self.embedding_service.generate_single_embedding(question)
            
            # Search vector DB with user and optional vendor filter
            results = self.vector_db.search_similar_filtered(
                query_embedding=query_embedding,
                user_id=user_id,
                vendor_name=vendor_name,
                n_results=n_results
            )
            
            if not results["documents"]:
                return {
                    "success": False,
                    "message": "No relevant documents found",
                    "answer": "I don't have any invoice data to answer your question.",
                    "sources": []
                }
            
            # Build sources for LLM
            sources = []
            for i, (doc, meta, dist) in enumerate(zip(
                results["documents"], 
                results["metadatas"], 
                results["distances"]
            )):
                sources.append({
                    "rank": i + 1,
                    "chunk_id": meta.get("chunk_id"),
                    "vendor_name": meta.get("vendor_name"),
                    "type": meta.get("type"),
                    "similarity": 1 - dist,
                    "content_excerpt": doc[:220] + ("..." if len(doc) > 220 else ""),
                    "invoice_number": meta.get("invoice_number"),
                    "invoice_date": meta.get("invoice_date"),
                    "total_amount": meta.get("total_amount"),
                    "drive_file_id": meta.get("drive_file_id"),
                    "file_name": meta.get("file_name"),
                    "web_view_link": meta.get("web_view_link"),
                    "web_content_link": meta.get("web_content_link"),
                })
            
            # Generate LLM answer
            rag_response = self.llm_service.generate_answer(question=question, sources=sources)
            
            return {
                "success": rag_response.get("success", False),
                "question": question,
                "answer": rag_response.get("answer", ""),
                "sources": sources,
                "vendor_name": vendor_name,
                "message": rag_response.get("message", "ok")
            }
            
        except Exception as e:
            return {
                "success": False,
                "message": f"Query failed: {e}",
                "answer": "",
                "sources": []
            }

    def get_analytics(self, user_id: str, period: str = "year") -> Dict[str, Any]:
        """Get spend analytics for a user."""
        try:
            # Get vendor spend totals for this user
            spend_ranking = self.vector_db.get_vendor_spend_totals(user_id)
            
            if not spend_ranking:
                return {"success": False, "message": "No spend data indexed"}

            # Calculate summary stats
            total_spend_all = sum(v["total_spend"] for v in spend_ranking)
            total_invoices_all = sum(v["invoice_count"] for v in spend_ranking) or 1
            average_invoice = total_spend_all / total_invoices_all
            
            highest = spend_ranking[0] if spend_ranking else {"vendor_name": "N/A", "total_spend": 0}

            # Get all invoice metadata for trends
            raw = self.vector_db.get_all_by_user(user_id)
            
            from collections import defaultdict
            import datetime
            monthly_totals = defaultdict(float)
            
            for meta in raw.get("metadatas", []):
                if not isinstance(meta, dict):
                    continue
                if meta.get("type") != "invoice":
                    continue
                    
                date_str = meta.get("invoice_date")
                amount_raw = meta.get("total_amount")
                
                try:
                    amount = float(str(amount_raw).replace(",", "")) if amount_raw is not None else 0.0
                except Exception:
                    amount = 0.0
                
                try:
                    dt = datetime.datetime.fromisoformat(date_str[:10]) if date_str else None
                except Exception:
                    dt = None
                
                if dt:
                    key = dt.strftime("%Y-%m")
                    monthly_totals[key] += amount
            
            sorted_months = sorted(monthly_totals.keys())
            
            # Filter by period
            if period == "month":
                last_key = sorted_months[-1] if sorted_months else None
                filtered = [last_key] if last_key else []
            elif period == "quarter":
                filtered = sorted_months[-3:]
            elif period == "year":
                filtered = sorted_months[-12:]
            else:
                filtered = sorted_months
            
            monthly_trend = [{"name": m, "value": monthly_totals[m]} for m in filtered]

            top_vendors = [
                {"name": v["vendor_name"], "value": v["total_spend"]}
                for v in spend_ranking
            ]
            
            spend_by_category = [
                {"name": v["vendor_name"], "value": v["total_spend"]}
                for v in spend_ranking[:8]
            ]
            
            # Quarterly aggregation
            from math import floor
            quarterly_map = defaultdict(float)
            for m, val in monthly_totals.items():
                try:
                    year, month = m.split('-')
                    q = f"{year}-Q{(floor((int(month)-1)/3)+1)}"
                    quarterly_map[q] += val
                except Exception:
                    pass
            quarterly_trend = [{"name": k, "value": v} for k, v in sorted(quarterly_map.items())][-8:]

            data = {
                "success": True,
                "insights": {
                    "highestSpend": {"vendor": highest["vendor_name"], "amount": highest["total_spend"]},
                    "averageInvoice": average_invoice,
                    "totalSpend": total_spend_all,
                    "totalInvoices": total_invoices_all,
                    "vendorCount": len(spend_ranking),
                },
                "monthlyTrend": monthly_trend,
                "topVendors": top_vendors,
                "spendByCategory": spend_by_category,
                "quarterlyTrend": quarterly_trend,
                "period": period,
            }
            
            # Generate LLM summary
            try:
                summary_prompt = (
                    "You are a financial spend analytics assistant. Given the following analytics, "
                    "produce a concise summary (2-3 sentences, max 120 words) highlighting: "
                    "overall spend, highest vendor, invoice volume, and notable trends.\n\n"
                    f"Total Spend: ₹{total_spend_all:,.2f}\n"
                    f"Total Invoices: {total_invoices_all}\n"
                    f"Vendor Count: {len(spend_ranking)}\n"
                    f"Highest Spend: {highest['vendor_name']} (₹{highest['total_spend']:,.2f})\n"
                    f"Average Invoice: ₹{average_invoice:,.2f}"
                )
                llm_text = self.llm_service.quick(summary_prompt, system="Spend Analytics Summarizer")
                data["llmSummary"] = llm_text.strip()
            except Exception as e:
                data["llmSummary"] = f"Summary generation failed: {e}"
            
            return data
            
        except Exception as e:
            return {"success": False, "message": f"Analytics computation failed: {e}"}

    def get_system_stats(self) -> Dict[str, Any]:
        """Get vector DB system stats."""
        try:
            db_stats = self.vector_db.get_collection_stats()
            return {"success": True, "stats": db_stats}
        except Exception as e:
            return {"success": False, "message": f"Error getting stats: {str(e)}"}

    def delete_user_data(self, user_id: str) -> Dict[str, Any]:
        """Delete all data for a user from vector DB."""
        try:
            success = self.vector_db.delete_user_data(user_id)
            return {
                "success": success,
                "message": "User data deleted successfully" if success else "Failed to delete user data"
            }
        except Exception as e:
            return {"success": False, "message": f"Error deleting user data: {str(e)}"}
