from django.db import migrations


def dedup_prompt_templates(apps, schema_editor):
    """Keep the oldest template per (owner, name, template_type) and delete the rest."""
    PromptTemplate = apps.get_model("interview", "PromptTemplate")
    seen = {}
    for tpl in PromptTemplate.objects.order_by("created_at"):
        key = (tpl.owner_id, tpl.name.strip().lower(), tpl.template_type)
        if key in seen:
            tpl.delete()
        else:
            seen[key] = tpl.pk


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0017_interviewsession_owner_nonnull"),
    ]

    operations = [
        migrations.RunPython(
            dedup_prompt_templates,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
