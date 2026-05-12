import { PRIVACY, TERMS, SAFETY, DISCLAIMER } from "@/lib/legal";
import { PageTransition } from "@/components/PageTransition";

export default function Legal({ doc }: { doc: "terms" | "privacy" | "disclaimer" | "safety" }) {
  let content = "";
  if (doc === "terms") content = TERMS;
  if (doc === "privacy") content = PRIVACY;
  if (doc === "safety") content = SAFETY;
  if (doc === "disclaimer") content = DISCLAIMER;

  const lines = content.split("\n");
  const title = lines[0];
  const bodyLines = lines.slice(1);

  return (
    <PageTransition className="flex-1 flex flex-col p-6 pb-24 max-w-prose mx-auto w-full">
      <h1 className="text-3xl font-bold mb-6">{title}</h1>
      
      {doc === "disclaimer" && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg font-semibold mb-6">
          You must be 18 years or older to use this platform.
        </div>
      )}

      <div className="prose dark:prose-invert prose-p:leading-relaxed prose-li:leading-relaxed text-foreground/90">
        {bodyLines.map((line, i) => {
          if (!line.trim()) return <br key={i} />;
          if (line.startsWith("Last updated:")) {
            return <p key={i} className="text-sm text-muted-foreground mt-8">{line}</p>;
          }
          if (line.length < 50 && !line.includes(".") && !line.startsWith("•")) {
             return <h3 key={i} className="text-xl font-semibold mt-6 mb-2">{line}</h3>;
          }
          if (line.startsWith("•")) {
            return <li key={i} className="ml-4">{line.substring(1).trim()}</li>;
          }
          return <p key={i} className="mb-4">{line}</p>;
        })}
      </div>
    </PageTransition>
  );
}
