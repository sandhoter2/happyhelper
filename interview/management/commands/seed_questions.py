from django.core.management.base import BaseCommand
from interview.models import QuestionBank

QUESTIONS = [
    # ── Behavioral ──────────────────────────────────────────────────────────────
    {"category": "behavioral", "difficulty": "easy", "question": "Tell me about yourself.", "hint": "Keep it to 2 minutes: current role, relevant background, why this opportunity. End with why you're here.", "tags": "intro,general"},
    {"category": "behavioral", "difficulty": "easy", "question": "Why do you want to work here?", "hint": "Research the company. Mention specific product, culture, or mission that genuinely excites you.", "tags": "motivation,general"},
    {"category": "behavioral", "difficulty": "medium", "question": "Tell me about a time you failed. How did you handle it?", "hint": "Own the failure clearly. Focus 80% on what you learned and changed afterward.", "tags": "failure,growth,star"},
    {"category": "behavioral", "difficulty": "medium", "question": "Describe a situation where you had to work with a difficult colleague.", "hint": "Show empathy and professionalism. Focus on the resolution, not the conflict.", "tags": "conflict,teamwork,star"},
    {"category": "behavioral", "difficulty": "medium", "question": "Tell me about a time you delivered a project under a tight deadline.", "hint": "Quantify the timeline and result. Emphasize prioritization and communication.", "tags": "deadline,pressure,star"},
    {"category": "behavioral", "difficulty": "medium", "question": "Give an example of when you showed initiative.", "hint": "Choose a story where you identified a gap and acted without being asked. Include the measurable outcome.", "tags": "initiative,leadership"},
    {"category": "behavioral", "difficulty": "hard", "question": "Tell me about a time you had to influence a decision without authority.", "hint": "Use data, stakeholder mapping, and framing. Show how you built consensus.", "tags": "influence,leadership,star"},
    {"category": "behavioral", "difficulty": "hard", "question": "Describe a situation where you had to manage competing priorities. How did you decide what to work on?", "hint": "Walk through your prioritization framework. Mention impact, urgency, and stakeholder alignment.", "tags": "prioritization,time-management"},

    # ── Technical ───────────────────────────────────────────────────────────────
    {"category": "technical", "difficulty": "easy", "question": "What is the difference between a process and a thread?", "hint": "Processes are isolated; threads share memory. Mention context switching, concurrency, and use cases.", "tags": "os,concurrency"},
    {"category": "technical", "difficulty": "easy", "question": "Explain the difference between SQL and NoSQL databases.", "hint": "Schema vs schema-less, ACID vs BASE, use cases for each. Name specific examples (Postgres, MongoDB).", "tags": "databases,storage"},
    {"category": "technical", "difficulty": "medium", "question": "How does a REST API differ from GraphQL?", "hint": "REST: resource-based, multiple endpoints, over/under-fetching. GraphQL: single endpoint, query exactly what you need.", "tags": "api,rest,graphql"},
    {"category": "technical", "difficulty": "medium", "question": "What is a race condition and how do you prevent it?", "hint": "Define: two threads reading/writing shared state with non-deterministic outcome. Solutions: locks, atomic ops, immutable data.", "tags": "concurrency,bugs"},
    {"category": "technical", "difficulty": "medium", "question": "Explain how garbage collection works in your primary language.", "hint": "Cover reference counting vs tracing GC. Mention generational GC (young/old), stop-the-world pauses, and tuning.", "tags": "memory,performance"},
    {"category": "technical", "difficulty": "hard", "question": "How would you debug a production memory leak?", "hint": "Heap profiling, object allocation tracking, isolating the leaking component. Mention tools like pprof, jmap, heaptrack.", "tags": "debugging,memory,production"},
    {"category": "technical", "difficulty": "hard", "question": "What strategies do you use to optimize slow database queries?", "hint": "EXPLAIN/ANALYZE, indexing strategy, N+1 problem, query restructuring, caching, denormalization trade-offs.", "tags": "databases,performance,optimization"},

    # ── System Design ────────────────────────────────────────────────────────────
    {"category": "system_design", "difficulty": "medium", "question": "Design a URL shortener like bit.ly.", "hint": "Hash function, collision handling, DB schema, redirect logic, analytics. Scale: read-heavy, CDN, caching.", "tags": "design,scale,url-shortener"},
    {"category": "system_design", "difficulty": "medium", "question": "How would you design a notification system that sends emails, SMS, and push notifications?", "hint": "Message queue (Kafka/SQS), fan-out per channel, retry logic, rate limiting, user preferences.", "tags": "design,messaging,notifications"},
    {"category": "system_design", "difficulty": "hard", "question": "Design a distributed rate limiter.", "hint": "Token bucket vs sliding window. Redis INCR/EXPIRE, Lua scripts for atomicity. Multi-region sync challenges.", "tags": "design,distributed,rate-limiting"},
    {"category": "system_design", "difficulty": "hard", "question": "Design Twitter's timeline / news feed.", "hint": "Fan-out on write vs fan-out on read. Redis sorted sets for timelines. Handle celebrities (>1M followers) separately.", "tags": "design,scale,feed,twitter"},
    {"category": "system_design", "difficulty": "hard", "question": "How would you design a distributed key-value store like Redis?", "hint": "Consistent hashing, replication (leader-follower), CAP theorem trade-offs, eviction policies, persistence (RDB/AOF).", "tags": "design,distributed,storage"},

    # ── Coding ───────────────────────────────────────────────────────────────────
    {"category": "coding", "difficulty": "easy", "question": "Reverse a string without using built-in reverse functions.", "hint": "Two-pointer approach: O(n) time, O(1) space. Walk through in-place swap.", "tags": "arrays,strings"},
    {"category": "coding", "difficulty": "easy", "question": "Check if a string is a palindrome.", "hint": "Two pointers from both ends. Handle case sensitivity and spaces if asked.", "tags": "strings,two-pointers"},
    {"category": "coding", "difficulty": "medium", "question": "Find the two numbers in an array that sum to a target.", "hint": "Hash map: store seen values, check complement. O(n) time, O(n) space. Discuss sorted array approach too.", "tags": "arrays,hash-map,two-sum"},
    {"category": "coding", "difficulty": "medium", "question": "Implement a function to detect a cycle in a linked list.", "hint": "Floyd's cycle detection: slow/fast pointers. O(n) time, O(1) space.", "tags": "linked-lists,two-pointers"},
    {"category": "coding", "difficulty": "medium", "question": "Find the longest substring without repeating characters.", "hint": "Sliding window + hash map. Move left pointer when duplicate found. O(n) time.", "tags": "strings,sliding-window"},
    {"category": "coding", "difficulty": "hard", "question": "Implement LRU Cache with O(1) get and put.", "hint": "HashMap + doubly linked list. HashMap for O(1) access; list for O(1) remove/insert at head/tail.", "tags": "design,cache,linked-lists,hash-map"},
    {"category": "coding", "difficulty": "hard", "question": "Find the median of two sorted arrays in O(log(m+n)) time.", "hint": "Binary search on the smaller array. Partition both arrays such that left half ≤ right half.", "tags": "binary-search,arrays,hard"},

    # ── Culture Fit ──────────────────────────────────────────────────────────────
    {"category": "culture", "difficulty": "easy", "question": "What kind of work environment do you thrive in?", "hint": "Align with the company's known culture. Be specific about remote/in-person, structure, autonomy.", "tags": "culture,values"},
    {"category": "culture", "difficulty": "medium", "question": "How do you stay up to date with technology trends?", "hint": "Mention specific sources: blogs, papers, communities, side projects. Show genuine curiosity.", "tags": "learning,growth"},
    {"category": "culture", "difficulty": "medium", "question": "What does good code mean to you?", "hint": "Readable, testable, maintainable, performant. Balance pragmatism with craftsmanship.", "tags": "values,engineering"},
    {"category": "culture", "difficulty": "medium", "question": "Where do you see yourself in 5 years?", "hint": "Align with the role's growth path. Show ambition but also commitment to depth in this role.", "tags": "career,ambition"},

    # ── Leadership ───────────────────────────────────────────────────────────────
    {"category": "leadership", "difficulty": "medium", "question": "Tell me about a time you mentored a junior engineer.", "hint": "Specific example: what you taught, how you adapted to their learning style, the outcome for them and the team.", "tags": "mentoring,leadership"},
    {"category": "leadership", "difficulty": "medium", "question": "How do you handle disagreement with your manager?", "hint": "Show data/reasoning first. Disagree and commit once a decision is made. Don't be a pushover or sycophant.", "tags": "communication,conflict,leadership"},
    {"category": "leadership", "difficulty": "hard", "question": "Describe a time you led a cross-functional project with no formal authority.", "hint": "Stakeholder alignment, shared goals, regular communication cadence, escalation path. Quantify the result.", "tags": "leadership,cross-functional,influence"},
    {"category": "leadership", "difficulty": "hard", "question": "Tell me about a time a project failed under your leadership. What did you do?", "hint": "Own it. Blameless post-mortem mindset. What changed systemically? Show psychological safety.", "tags": "failure,leadership,star"},
]


class Command(BaseCommand):
    help = "Seed the QuestionBank with common interview questions"

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Delete all existing questions first")

    def handle(self, *args, **options):
        if options["clear"]:
            count = QuestionBank.objects.all().delete()[0]
            self.stdout.write(f"Deleted {count} existing questions.")

        created = 0
        skipped = 0
        for q in QUESTIONS:
            obj, was_created = QuestionBank.objects.get_or_create(
                question=q["question"],
                defaults={
                    "category": q["category"],
                    "difficulty": q["difficulty"],
                    "hint": q.get("hint", ""),
                    "tags": q.get("tags", ""),
                    "is_active": True,
                },
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f"Done. Created {created} questions, skipped {skipped} duplicates."
        ))
