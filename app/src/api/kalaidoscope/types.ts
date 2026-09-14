/**
* This file was @generated using pocketbase-typegen
*/

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export const Collections = {
	Authorigins: "_authOrigins",
	Externalauths: "_externalAuths",
	Mfas: "_mfas",
	Otps: "_otps",
	Superusers: "_superusers",
	ChatConversation: "chat_conversation",
	ChatMessage: "chat_message",
	Colour: "colour",
	ColourFragment: "colour_fragment",
	DiscoverRun: "discover_run",
	Fragment: "fragment",
	FragmentAnnotation: "fragment_annotation",
	Ingest: "ingest",
	KalaidoscopeConfig: "kalaidoscope_config",
	KalaidoscopeMap: "kalaidoscope_map",
	Lens: "lens",
	LlmQueueStatus: "llm_queue_status",
	MapRun: "map_run",
	Projection: "projection",
	ProjectionRefinement: "projection_refinement",
	ProjectionSnapshot: "projection_snapshot",
	Reflection: "reflection",
	ReflectionRefinement: "reflection_refinement",
	ReflectionSnapshot: "reflection_snapshot",
	ReflectionWindow: "reflection_window",
	Usage: "usage",
	Users: "users",
	ViewStream: "view_stream",
} as const
export type Collections = typeof Collections[keyof typeof Collections]

// Alias types for improved usability
export type IsoDateString = string
export type IsoAutoDateString = string & { readonly autodate: unique symbol }
export type RecordIdString = string
export type FileNameString = string & { readonly filename: unique symbol }
export type HTMLString = string

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T }

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString
	collectionId: string
	collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
	email: string
	emailVisibility: boolean
	username: string
	verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	fingerprint: string
	id: string
	recordRef: string
	updated: IsoAutoDateString
}

export type ExternalauthsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	provider: string
	providerId: string
	recordRef: string
	updated: IsoAutoDateString
}

export type MfasRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	method: string
	recordRef: string
	updated: IsoAutoDateString
}

export type OtpsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	password: string
	recordRef: string
	sentTo?: string
	updated: IsoAutoDateString
}

export type SuperusersRecord = {
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export type ChatConversationRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	generate_with_model?: string
	id: string
}

export type ChatMessageRecord<Tcontent = unknown> = {
	chat_conversation_id?: RecordIdString
	content?: null | Tcontent
	created: IsoAutoDateString
	generated_by_model?: string
	id: string
	projection_refinement_id?: RecordIdString
	reflection_refinement_id?: RecordIdString
	updated: IsoAutoDateString
}

export type ColourRecord<Tthing_ids = unknown> = {
	created: IsoAutoDateString
	created_by_discover_run_id?: RecordIdString
	id: string
	last_provider_error_kind?: string
	name: string
	prompt?: string
	prompt_match_completed_up_to_fragment_id?: RecordIdString
	swatch?: number
	thing_ids?: null | Tthing_ids
	updated: IsoAutoDateString
}

export const ColourFragmentMatchTypeOptions = {
	"manual_positive": "manual_positive",
	"manual_negative": "manual_negative",
	"thing": "thing",
	"prompt": "prompt",
} as const
export type ColourFragmentMatchTypeOptions = typeof ColourFragmentMatchTypeOptions[keyof typeof ColourFragmentMatchTypeOptions]
export type ColourFragmentRecord = {
	colour_id: RecordIdString
	created: IsoAutoDateString
	fragment_id: RecordIdString
	id: string
	match_type: ColourFragmentMatchTypeOptions
}

export const DiscoverRunKindOptions = {
	"projections": "projections",
	"reflections": "reflections",
	"colours": "colours",
} as const
export type DiscoverRunKindOptions = typeof DiscoverRunKindOptions[keyof typeof DiscoverRunKindOptions]

export const DiscoverRunStatusOptions = {
	"running": "running",
	"done": "done",
	"error": "error",
} as const
export type DiscoverRunStatusOptions = typeof DiscoverRunStatusOptions[keyof typeof DiscoverRunStatusOptions]
export type DiscoverRunRecord<Toutputs = unknown> = {
	created: IsoAutoDateString
	error?: string
	fragment_reads?: number
	generated_by_model?: string
	id: string
	kind: DiscoverRunKindOptions
	map_version?: number
	outputs?: null | Toutputs
	rounds?: number
	status: DiscoverRunStatusOptions
	summary?: string
	updated: IsoAutoDateString
}

export const FragmentTypeOptions = {
	"email": "email",
	"note": "note",
	"chat": "chat",
	"edit": "edit",
} as const
export type FragmentTypeOptions = typeof FragmentTypeOptions[keyof typeof FragmentTypeOptions]

export const FragmentIngestedViaOptions = {
	"import": "import",
	"app": "app",
	"sync": "sync",
} as const
export type FragmentIngestedViaOptions = typeof FragmentIngestedViaOptions[keyof typeof FragmentIngestedViaOptions]
export type FragmentRecord = {
	content: string
	created: IsoAutoDateString
	deleted_at?: IsoDateString
	id: string
	ingested_via?: FragmentIngestedViaOptions
	occurred_at?: IsoDateString
	source?: string
	type: FragmentTypeOptions
}

export type FragmentAnnotationRecord<Tconclusions = unknown, Tdecisions = unknown, Tquestions = unknown, Tthings = unknown> = {
	conclusions?: null | Tconclusions
	consolidated_at?: IsoDateString
	created: IsoAutoDateString
	decisions?: null | Tdecisions
	fragment_id: RecordIdString
	generated_by_model?: string
	generated_from_map_version?: number
	id: string
	questions?: null | Tquestions
	summary?: string
	things?: null | Tthings
	title?: string
}

export const IngestFormatOptions = {
	"zip": "zip",
	"mbox": "mbox",
	"docx": "docx",
	"text": "text",
} as const
export type IngestFormatOptions = typeof IngestFormatOptions[keyof typeof IngestFormatOptions]

export const IngestStatusOptions = {
	"pending": "pending",
	"done": "done",
	"error": "error",
} as const
export type IngestStatusOptions = typeof IngestStatusOptions[keyof typeof IngestStatusOptions]
export type IngestRecord = {
	created: IsoAutoDateString
	error?: string
	extensions?: string
	file?: FileNameString[]
	format?: IngestFormatOptions
	fragment_limit?: number
	id: string
	ingested?: number
	organize_after?: boolean
	skip_duplicates?: boolean
	status?: IngestStatusOptions
	updated: IsoAutoDateString
}

export type KalaidoscopeConfigRecord<Trole_models = unknown> = {
	api_key?: string
	created: IsoAutoDateString
	default_model?: string
	id: string
	model_set?: string
	provider?: string
	role_models?: null | Trole_models
	updated: IsoAutoDateString
}

export type KalaidoscopeMapRecord<Tbody = unknown> = {
	body?: null | Tbody
	consolidated_at?: IsoDateString
	created: IsoAutoDateString
	id: string
	updated: IsoAutoDateString
	version?: number
}

export type LensRecord = {
	created: IsoAutoDateString
	created_from_projection_refinement_id?: RecordIdString
	created_from_reflection_refinement_id?: RecordIdString
	id: string
	parent_lens_id?: RecordIdString
	prompt?: string
}

export const LlmQueueStatusStateOptions = {
	"idle": "idle",
	"active": "active",
} as const
export type LlmQueueStatusStateOptions = typeof LlmQueueStatusStateOptions[keyof typeof LlmQueueStatusStateOptions]
export type LlmQueueStatusRecord<Theld = unknown, Trunning = unknown, Twaiting = unknown> = {
	created: IsoAutoDateString
	held?: null | Theld
	id: string
	running?: null | Trunning
	state?: LlmQueueStatusStateOptions
	updated: IsoAutoDateString
	waiting?: null | Twaiting
}

export const MapRunStatusOptions = {
	"running": "running",
	"done": "done",
	"error": "error",
} as const
export type MapRunStatusOptions = typeof MapRunStatusOptions[keyof typeof MapRunStatusOptions]
export type MapRunRecord = {
	admits?: number
	created: IsoAutoDateString
	error?: string
	generated_by_model?: string
	id: string
	merges?: number
	pending_in?: number
	status: MapRunStatusOptions
	updated: IsoAutoDateString
	version_after?: number
	version_before?: number
}

export const ProjectionStatusOptions = {
	"proposed": "proposed",
	"active": "active",
} as const
export type ProjectionStatusOptions = typeof ProjectionStatusOptions[keyof typeof ProjectionStatusOptions]
export type ProjectionRecord<Tcurrent_context_spec = unknown> = {
	created: IsoAutoDateString
	created_by_discover_run_id?: RecordIdString
	current_context_spec?: null | Tcurrent_context_spec
	current_lens_id?: RecordIdString
	description?: string
	generate_with_model?: string
	id: string
	name?: string
	pinned_by?: RecordIdString[]
	status: ProjectionStatusOptions
	updated: IsoAutoDateString
}

export type ProjectionRefinementRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	id: string
	projection_id?: RecordIdString
	projection_snapshot_id?: RecordIdString
}

export const ProjectionSnapshotStatusOptions = {
	"generating": "generating",
	"pending_review": "pending_review",
	"approved": "approved",
	"discarded": "discarded",
} as const
export type ProjectionSnapshotStatusOptions = typeof ProjectionSnapshotStatusOptions[keyof typeof ProjectionSnapshotStatusOptions]

export const ProjectionSnapshotGenerationTriggerOptions = {
	"generate_all": "generate_all",
} as const
export type ProjectionSnapshotGenerationTriggerOptions = typeof ProjectionSnapshotGenerationTriggerOptions[keyof typeof ProjectionSnapshotGenerationTriggerOptions]
export type ProjectionSnapshotRecord<Tcontext_spec = unknown, Tresolved_context = unknown> = {
	approval_sequence_number?: number
	approved_at?: IsoDateString
	context_spec?: null | Tcontext_spec
	created: IsoAutoDateString
	created_from_refinement_id?: RecordIdString
	generated_at?: IsoDateString
	generated_by_model?: string
	generation_trigger?: ProjectionSnapshotGenerationTriggerOptions
	id: string
	lens_id?: RecordIdString
	output?: string
	projection_id: RecordIdString
	resolved_context?: null | Tresolved_context
	status: ProjectionSnapshotStatusOptions
	updated: IsoAutoDateString
}

export const ReflectionStatusOptions = {
	"proposed": "proposed",
	"active": "active",
} as const
export type ReflectionStatusOptions = typeof ReflectionStatusOptions[keyof typeof ReflectionStatusOptions]
export type ReflectionRecord<Tcurrent_context_spec = unknown, Twindow_spec_versions = unknown> = {
	created: IsoAutoDateString
	created_by_discover_run_id?: RecordIdString
	current_context_spec?: null | Tcurrent_context_spec
	current_lens_id?: RecordIdString
	description?: string
	generate_with_model?: string
	id: string
	name?: string
	pinned_by?: RecordIdString[]
	status: ReflectionStatusOptions
	updated: IsoAutoDateString
	window_spec_versions?: null | Twindow_spec_versions
}

export type ReflectionRefinementRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	id: string
	reflection_id?: RecordIdString
	reflection_snapshot_id?: RecordIdString
}

export const ReflectionSnapshotStatusOptions = {
	"generating": "generating",
	"pending_review": "pending_review",
	"approved": "approved",
	"discarded": "discarded",
} as const
export type ReflectionSnapshotStatusOptions = typeof ReflectionSnapshotStatusOptions[keyof typeof ReflectionSnapshotStatusOptions]

export const ReflectionSnapshotGenerationTriggerOptions = {
	"generate_all": "generate_all",
} as const
export type ReflectionSnapshotGenerationTriggerOptions = typeof ReflectionSnapshotGenerationTriggerOptions[keyof typeof ReflectionSnapshotGenerationTriggerOptions]
export type ReflectionSnapshotRecord<Tcontext_spec = unknown, Tresolved_context = unknown> = {
	approval_sequence_number?: number
	approved_at?: IsoDateString
	context_spec?: null | Tcontext_spec
	created: IsoAutoDateString
	created_from_refinement_id?: RecordIdString
	generated_at?: IsoDateString
	generated_by_model?: string
	generation_trigger?: ReflectionSnapshotGenerationTriggerOptions
	id: string
	lens_id?: RecordIdString
	output?: string
	reflection_id: RecordIdString
	resolved_context?: null | Tresolved_context
	status: ReflectionSnapshotStatusOptions
	updated: IsoAutoDateString
	window_end?: IsoDateString
	window_start?: IsoDateString
}

export type ReflectionWindowRecord = {
	created: IsoAutoDateString
	id: string
	reflection_id: RecordIdString
	window_end: IsoDateString
	window_start: IsoDateString
}

export type UsageRecord = {
	cached_tokens?: number
	completion_tokens?: number
	created: IsoAutoDateString
	id: string
	period: string
	prompt_tokens?: number
	total_tokens?: number
	updated: IsoAutoDateString
}

export type UsersRecord = {
	avatar?: FileNameString
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	name?: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export const ViewStreamTypeOptions = {
	"email": "email",
	"note": "note",
	"chat": "chat",
	"edit": "edit",
} as const
export type ViewStreamTypeOptions = typeof ViewStreamTypeOptions[keyof typeof ViewStreamTypeOptions]
export type ViewStreamRecord<Tcolour_ids = unknown> = {
	colour_ids?: null | Tcolour_ids
	content: string
	created: IsoAutoDateString
	id: string
	occurred_at?: IsoDateString
	title?: string
	type: ViewStreamTypeOptions
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> & BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type ChatConversationResponse<Texpand = unknown> = Required<ChatConversationRecord> & BaseSystemFields<Texpand>
export type ChatMessageResponse<Tcontent = unknown, Texpand = unknown> = Required<ChatMessageRecord<Tcontent>> & BaseSystemFields<Texpand>
export type ColourResponse<Tthing_ids = unknown, Texpand = unknown> = Required<ColourRecord<Tthing_ids>> & BaseSystemFields<Texpand>
export type ColourFragmentResponse<Texpand = unknown> = Required<ColourFragmentRecord> & BaseSystemFields<Texpand>
export type DiscoverRunResponse<Toutputs = unknown, Texpand = unknown> = Required<DiscoverRunRecord<Toutputs>> & BaseSystemFields<Texpand>
export type FragmentResponse<Texpand = unknown> = Required<FragmentRecord> & BaseSystemFields<Texpand>
export type FragmentAnnotationResponse<Tconclusions = unknown, Tdecisions = unknown, Tquestions = unknown, Tthings = unknown, Texpand = unknown> = Required<FragmentAnnotationRecord<Tconclusions, Tdecisions, Tquestions, Tthings>> & BaseSystemFields<Texpand>
export type IngestResponse<Texpand = unknown> = Required<IngestRecord> & BaseSystemFields<Texpand>
export type KalaidoscopeConfigResponse<Trole_models = unknown, Texpand = unknown> = Required<KalaidoscopeConfigRecord<Trole_models>> & BaseSystemFields<Texpand>
export type KalaidoscopeMapResponse<Tbody = unknown, Texpand = unknown> = Required<KalaidoscopeMapRecord<Tbody>> & BaseSystemFields<Texpand>
export type LensResponse<Texpand = unknown> = Required<LensRecord> & BaseSystemFields<Texpand>
export type LlmQueueStatusResponse<Theld = unknown, Trunning = unknown, Twaiting = unknown, Texpand = unknown> = Required<LlmQueueStatusRecord<Theld, Trunning, Twaiting>> & BaseSystemFields<Texpand>
export type MapRunResponse<Texpand = unknown> = Required<MapRunRecord> & BaseSystemFields<Texpand>
export type ProjectionResponse<Tcurrent_context_spec = unknown, Texpand = unknown> = Required<ProjectionRecord<Tcurrent_context_spec>> & BaseSystemFields<Texpand>
export type ProjectionRefinementResponse<Texpand = unknown> = Required<ProjectionRefinementRecord> & BaseSystemFields<Texpand>
export type ProjectionSnapshotResponse<Tcontext_spec = unknown, Tresolved_context = unknown, Texpand = unknown> = Required<ProjectionSnapshotRecord<Tcontext_spec, Tresolved_context>> & BaseSystemFields<Texpand>
export type ReflectionResponse<Tcurrent_context_spec = unknown, Twindow_spec_versions = unknown, Texpand = unknown> = Required<ReflectionRecord<Tcurrent_context_spec, Twindow_spec_versions>> & BaseSystemFields<Texpand>
export type ReflectionRefinementResponse<Texpand = unknown> = Required<ReflectionRefinementRecord> & BaseSystemFields<Texpand>
export type ReflectionSnapshotResponse<Tcontext_spec = unknown, Tresolved_context = unknown, Texpand = unknown> = Required<ReflectionSnapshotRecord<Tcontext_spec, Tresolved_context>> & BaseSystemFields<Texpand>
export type ReflectionWindowResponse<Texpand = unknown> = Required<ReflectionWindowRecord> & BaseSystemFields<Texpand>
export type UsageResponse<Texpand = unknown> = Required<UsageRecord> & BaseSystemFields<Texpand>
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> & AuthSystemFields<Texpand>
export type ViewStreamResponse<Tcolour_ids = unknown, Texpand = unknown> = Required<ViewStreamRecord<Tcolour_ids>> & BaseSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord
	_externalAuths: ExternalauthsRecord
	_mfas: MfasRecord
	_otps: OtpsRecord
	_superusers: SuperusersRecord
	chat_conversation: ChatConversationRecord
	chat_message: ChatMessageRecord
	colour: ColourRecord
	colour_fragment: ColourFragmentRecord
	discover_run: DiscoverRunRecord
	fragment: FragmentRecord
	fragment_annotation: FragmentAnnotationRecord
	ingest: IngestRecord
	kalaidoscope_config: KalaidoscopeConfigRecord
	kalaidoscope_map: KalaidoscopeMapRecord
	lens: LensRecord
	llm_queue_status: LlmQueueStatusRecord
	map_run: MapRunRecord
	projection: ProjectionRecord
	projection_refinement: ProjectionRefinementRecord
	projection_snapshot: ProjectionSnapshotRecord
	reflection: ReflectionRecord
	reflection_refinement: ReflectionRefinementRecord
	reflection_snapshot: ReflectionSnapshotRecord
	reflection_window: ReflectionWindowRecord
	usage: UsageRecord
	users: UsersRecord
	view_stream: ViewStreamRecord
}

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse
	_externalAuths: ExternalauthsResponse
	_mfas: MfasResponse
	_otps: OtpsResponse
	_superusers: SuperusersResponse
	chat_conversation: ChatConversationResponse
	chat_message: ChatMessageResponse
	colour: ColourResponse
	colour_fragment: ColourFragmentResponse
	discover_run: DiscoverRunResponse
	fragment: FragmentResponse
	fragment_annotation: FragmentAnnotationResponse
	ingest: IngestResponse
	kalaidoscope_config: KalaidoscopeConfigResponse
	kalaidoscope_map: KalaidoscopeMapResponse
	lens: LensResponse
	llm_queue_status: LlmQueueStatusResponse
	map_run: MapRunResponse
	projection: ProjectionResponse
	projection_refinement: ProjectionRefinementResponse
	projection_snapshot: ProjectionSnapshotResponse
	reflection: ReflectionResponse
	reflection_refinement: ReflectionRefinementResponse
	reflection_snapshot: ReflectionSnapshotResponse
	reflection_window: ReflectionWindowResponse
	usage: UsageResponse
	users: UsersResponse
	view_stream: ViewStreamResponse
}

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<{
	// Omit AutoDate fields
	[K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never]: 
		// Convert FileNameString to File
		T[K] extends infer U ? 
			U extends (FileNameString | FileNameString[]) ? 
				U extends any[] ? File[] : File 
			: U
		: never
}, 'id'>

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString
	email: string
	emailVisibility?: boolean
	password: string
	passwordConfirm: string
	verified?: boolean
} & ProcessCreateAndUpdateFields<T>

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString
} & ProcessCreateAndUpdateFields<T>

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string
	emailVisibility?: boolean
	oldPassword?: string
	password?: string
	passwordConfirm?: string
	verified?: boolean
}

// Update type for Base collections
export type UpdateBase<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>
>

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>
} & PocketBase
