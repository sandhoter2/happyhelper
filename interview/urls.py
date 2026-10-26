from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("pricing/", views.pricing_view, name="pricing"),
    path("session/new/", views.new_session, name="new_session"),
    path("session/<uuid:session_id>/", views.live_session, name="live_session"),
    path("session/<uuid:session_id>/detail/", views.session_detail, name="session_detail"),
    path("settings/", views.settings_page, name="settings"),
    path("profile/", views.profile_page, name="profile"),
    # API
    path("api/sessions/", views.api_list_sessions, name="api_list_sessions"),
    path("api/session/<uuid:session_id>/activate/", views.api_activate_session, name="api_activate"),
    path("api/session/<uuid:session_id>/end/", views.api_end_session, name="api_end"),
    path("api/session/<uuid:session_id>/transcript/", views.api_transcript, name="api_transcript"),
    path("api/session/<uuid:session_id>/audio-chunk/", views.api_save_audio_chunk, name="api_audio_chunk"),
    path("api/session/<uuid:session_id>/conversation-helper/", views.api_conversation_helper, name="api_conv_helper"),
    path("api/session/<uuid:session_id>/transcribe/", views.api_transcribe, name="api_transcribe"),
    path("api/session/<uuid:session_id>/chat/", views.api_chat, name="api_chat"),
    path("api/session/<uuid:session_id>/context/", views.api_session_context, name="api_session_context"),
    path("api/session/<uuid:session_id>/data/", views.api_session_data, name="api_data"),
    path("api/session/<uuid:session_id>/delete/", views.api_delete_session, name="api_delete"),
    path("api/session/<uuid:session_id>/edit/", views.api_edit_session, name="api_edit"),
    path("api/session/<uuid:session_id>/export/", views.api_export_session, name="api_export"),
    path("api/session/<uuid:session_id>/note/", views.api_add_note, name="api_note"),
    # Teams Recorder
    path("api/session/<uuid:session_id>/participants/", views.api_meeting_participants, name="api_participants"),
    path("api/session/<uuid:session_id>/participants/<uuid:participant_id>/delete/", views.api_delete_participant, name="api_delete_participant"),
    path("api/session/<uuid:session_id>/scan-participants/", views.api_scan_participants, name="api_scan_participants"),
    path("api/session/<uuid:session_id>/extract-captions/", views.api_extract_captions, name="api_extract_captions"),
    path("api/session/<uuid:session_id>/entry/<uuid:entry_id>/speaker/", views.api_update_entry_speaker, name="api_entry_speaker"),
    path("api/session/<uuid:session_id>/meeting-summary/", views.api_meeting_summary, name="api_meeting_summary"),
    path("api/build-conversation/", views.api_build_conversation, name="api_build_conversation"),
    path("api/config/", views.api_config, name="api_config"),
    path("api/deepgram-token/", views.api_deepgram_token, name="api_deepgram_token"),
    path("api/session/<uuid:session_id>/screen-ocr/", views.api_screen_ocr, name="api_screen_ocr"),
    path("api/regenerate-token/", views.api_regenerate_token, name="api_regenerate_token"),
    # Stats
    path("api/stats/", views.api_stats, name="api_stats"),
    # Session scoring
    path("api/session/<uuid:session_id>/score/", views.api_session_score, name="api_session_score"),
    # Billing
    path("billing/checkout/<str:plan>/", views.billing_checkout, name="billing_checkout"),
    path("billing/success/", views.billing_success, name="billing_success"),
    path("billing/portal/", views.billing_portal, name="billing_portal"),
    path("billing/webhook/", views.stripe_webhook, name="stripe_webhook"),
    # Onboarding
    path("onboarding/", views.onboarding_view, name="onboarding"),
    # Desktop overlay auth
    path("api/login/", views.api_login, name="api_login"),
    path("api/session/new/", views.api_new_session, name="api_new_session"),
    # Admin: DB Sync Portal
    path("admin-portal/db-sync/", views.admin_db_sync, name="admin_db_sync"),
    path("admin-portal/db-sync/action/", views.admin_db_sync_action, name="admin_db_sync_action"),
    # Templates
    path("templates/", views.templates_page, name="templates_page"),
    path("api/templates/", views.api_templates_list, name="api_templates_list"),
    path("api/templates/create/", views.api_template_create, name="api_template_create"),
    path("api/templates/<int:template_id>/update/", views.api_template_update, name="api_template_update"),
    path("api/templates/<int:template_id>/delete/", views.api_template_delete, name="api_template_delete"),
    path("api/templates/<int:template_id>/reset/", views.api_template_reset, name="api_template_reset"),
    path("api/theme/", views.api_toggle_theme, name="api_theme"),
    # Question Bank
    path("questions/", views.questions_page, name="questions"),
    path("api/questions/", views.api_questions_list, name="api_questions"),
    # Mock Interview
    path("api/session/<uuid:session_id>/mock-question/", views.api_mock_question, name="api_mock_question"),
    # Coding Interview Helper
    path("api/session/<uuid:session_id>/code-help/", views.api_code_help, name="api_code_help"),
    # Detailed Post-Session Feedback
    path("api/session/<uuid:session_id>/feedback/", views.api_session_feedback, name="api_session_feedback"),
    # Documents
    path("documents/", views.documents_page, name="documents_page"),
    path("api/documents/", views.api_documents_list, name="api_documents_list"),
    path("api/documents/upload/", views.api_document_upload, name="api_document_upload"),
    path("api/documents/<uuid:document_id>/status/", views.api_document_status, name="api_document_status"),
    path("api/documents/<uuid:document_id>/delete/", views.api_document_delete, name="api_document_delete"),
    path("api/documents/<uuid:document_id>/move/", views.api_document_move, name="api_document_move"),
    path("api/folders/create/", views.api_folder_create, name="api_folder_create"),
    path("api/folders/<uuid:folder_id>/delete/", views.api_folder_delete, name="api_folder_delete"),
    path("api/session/<uuid:session_id>/documents/", views.api_session_documents_list, name="api_session_documents_list"),
    path("api/session/<uuid:session_id>/documents/attach/", views.api_session_documents_attach, name="api_session_documents_attach"),
    path("api/session/<uuid:session_id>/documents/<uuid:document_id>/detach/", views.api_session_document_detach, name="api_session_document_detach"),
    # Feature Requests / Open Tickets
    path("feedback/", views.feedback_page, name="feedback_page"),
    path("api/feedback/submit/", views.api_submit_feedback, name="api_submit_feedback"),
    path("admin-portal/feedback/", views.admin_feedback, name="admin_feedback"),
    path("admin-portal/feedback/<int:request_id>/action/", views.admin_feedback_action, name="admin_feedback_action"),
]
